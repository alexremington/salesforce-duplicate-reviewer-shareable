#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const SERVER_SCRIPT = path.join("server", "server.js");
const PUBLIC_DIR = path.join(PROJECT_DIR, "public");
const APP_NAME = "Salesforce Duplicate Reviewer";
const APP_ID = "salesforce-duplicate-reviewer";
const URL_ENV = "DUPLICATE_REVIEWER_URL";
const READY_PATH = "/api/health";
const READY_ATTEMPTS = 80;
const READY_DELAY_MS = 250;

let serverProcess = null;
let smokeStagingDir = "";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  smokeStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-reviewer-staging-"));
  const contactsCsvPath = path.join(smokeStagingDir, "contacts-latest.csv");
  const accountsCsvPath = path.join(smokeStagingDir, "accounts-latest.csv");
  const contactsJsonPath = contactsCsvPath.replace(/\.csv$/i, ".json");
  const accountsJsonPath = accountsCsvPath.replace(/\.csv$/i, ".json");
  await fs.writeFile(contactsCsvPath, [
    "Id,First Name,Last Name,Company,Email",
    "003T00000090001,Smoke,Contact,Northstar,smoke-contact@example.com",
    "003T00000090002,Smoke,Contact,Northstar Inc,smoke-contact@example.com"
  ].join("\n"));
  await fs.writeFile(accountsCsvPath, [
    "Id,Name,Website,Billing City",
    "001T00000090001,Smoke Account,smoke.example,San Francisco",
    "001T00000090002,Smoke Account Inc,https://smoke.example,San Francisco"
  ].join("\n"));
  await fs.writeFile(contactsJsonPath, JSON.stringify({
    columns: ["Id", "First Name", "Last Name", "Company", "Email"],
    rows: [
      ["003T00000090001", "Smoke", "Contact", "Northstar", "smoke-contact@example.com"],
      ["003T00000090002", "Smoke", "Contact", "Northstar Inc", "smoke-contact@example.com"]
    ]
  }, null, 2));
  await fs.writeFile(accountsJsonPath, JSON.stringify({
    columns: ["Id", "Name", "Website", "Billing City"],
    rows: [
      ["001T00000090001", "Smoke Account", "smoke.example", "San Francisco"],
      ["001T00000090002", "Smoke Account Inc", "https://smoke.example", "San Francisco"]
    ]
  }, null, 2));

  const serverEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DUPLICATE_REVIEWER_STATIC_DIR: PUBLIC_DIR,
    STAGING_CONTACTS_CSV: contactsCsvPath,
    STAGING_ACCOUNTS_CSV: accountsCsvPath
  };

  serverProcess = childProcess.spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: PROJECT_DIR,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverLogs = captureProcessLogs(serverProcess, APP_NAME);

  try {
    await waitForReady(baseUrl, serverProcess, serverLogs);
    const smokeExitCode = await runCommand(process.execPath, ["tests/playwright-smoke.js"], {
      ...process.env,
      [URL_ENV]: baseUrl
    });
    process.exitCode = smokeExitCode;
  } finally {
    await stopProcess(serverProcess);
    if (smokeStagingDir) {
      await fs.rm(smokeStagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function captureProcessLogs(processHandle, label) {
  const lines = [];
  const append = (streamName, chunk) => {
    const text = String(chunk || "");
    text.split(/\r?\n/).filter(Boolean).forEach((line) => {
      lines.push(`[${label} ${streamName}] ${line}`);
      if (lines.length > 120) lines.shift();
    });
  };

  processHandle.stdout.on("data", (chunk) => append("stdout", chunk));
  processHandle.stderr.on("data", (chunk) => append("stderr", chunk));
  return lines;
}

async function waitForReady(baseUrl, processHandle, serverLogs) {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`${APP_NAME} server exited before it became ready.\n${serverLogs.join("\n")}`);
    }

    try {
      const health = await requestJson(`${baseUrl}${READY_PATH}`);
      if (health.appId !== APP_ID) {
        throw new Error(`Unexpected app id from ${READY_PATH}: ${JSON.stringify(health)}`);
      }
      return;
    } catch (error) {
      if (attempt === READY_ATTEMPTS) {
        throw new Error(`${APP_NAME} did not become ready at ${baseUrl}.\n${serverLogs.join("\n")}\nLast error: ${error.message}`);
      }
      await delay(READY_DELAY_MS);
    }
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timed out")));
    request.on("error", reject);
  });
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: PROJECT_DIR,
      env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }
      resolve(code || 0);
    });
  });
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;

  if (process.platform === "win32") {
    childProcess.spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  processHandle.kill("SIGTERM");
  await Promise.race([
    onceExit(processHandle),
    delay(3000).then(() => {
      if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    })
  ]);
}

function onceExit(processHandle) {
  return new Promise((resolve) => {
    if (processHandle.exitCode !== null) {
      resolve();
      return;
    }
    processHandle.once("exit", resolve);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
