#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { loadChromium } = require("../vendor/managed-app/scripts/smoke-test-harness");
const { contactSmokeCsv } = require("../tests/fixtures/duplicate-reviewer-workflows");

const PROJECT_DIR = path.resolve(__dirname, "..");
const SERVER_SCRIPT = path.join("server", "server.js");
const PUBLIC_DIR = path.join(PROJECT_DIR, "public");
const APP_ID = "salesforce-duplicate-reviewer";
const READY_PATH = "/api/health";
const READY_ATTEMPTS = 80;
const READY_DELAY_MS = 250;
const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(
    PROJECT_DIR,
    "docs",
    "design-proposals",
    "merge-preview-confirmation",
    "implemented-multi-group-merge-review.png"
  );

let serverProcess = null;
let stagingDir = "";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-reviewer-capture-"));
  const contactsCsvPath = path.join(stagingDir, "contacts-latest.csv");
  await fs.writeFile(contactsCsvPath, "Id,First Name,Last Name,Company,Email\n");

  serverProcess = childProcess.spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DUPLICATE_REVIEWER_STATIC_DIR: PUBLIC_DIR,
      STAGING_CONTACTS_CSV: contactsCsvPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = captureProcessLogs(serverProcess);
  try {
    await waitForReady(baseUrl, serverProcess, logs);
    await captureScreenshot(baseUrl);
  } finally {
    await stopProcess(serverProcess);
    if (stagingDir) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function captureScreenshot(baseUrl) {
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1280 }, deviceScaleFactor: 1 });
  const tempCsvPath = path.join(stagingDir, "contacts-smoke.csv");
  await fs.writeFile(tempCsvPath, contactSmokeCsv());

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 15000 });
    await page.locator("#csvInput").setInputFiles(tempCsvPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 15000 });
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });

    for (let index = 0; index < 3; index += 1) {
      await page.locator(".group-item-main").nth(index).click();
      await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
      await page.locator("#decisionStatus").filter({ hasText: "Duplicate decision: Duplicate" }).waitFor({ state: "visible", timeout: 5000 });
    }

    await page.locator(".group-item-main").first().click();
    await page.locator('[data-review-mode="merge"]').click();
    await page.locator(".merge-master-radio").first().waitFor({ state: "visible", timeout: 5000 });
    if (await page.locator(".merge-master-radio").count() > 1) {
      await page.locator(".merge-master-radio").nth(1).check();
    }

    await page.evaluate(() => {
      const radios = [...document.querySelectorAll(".merge-field-radio:not(:disabled)")];
      const candidate = radios.find((radio) => {
        if (radio.checked) return false;
        const siblings = radios.filter((sibling) => sibling.name === radio.name);
        const checkedSibling = siblings.find((sibling) => sibling.checked);
        return checkedSibling && checkedSibling.value !== radio.value;
      });
      if (candidate) candidate.click();
    });

    await page.route("**/api/salesforce/premerge-check", async (route) => {
      const payload = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "fresh",
          checkedAt: new Date().toISOString(),
          objectType: "Contact",
          groupKey: payload.groupKey,
          masterId: payload.masterId,
          mergeIds: payload.mergeIds || [],
          ids: [payload.masterId, ...(payload.mergeIds || [])].filter(Boolean),
          missingIds: [],
          deletedIds: [],
          changedFields: [],
          currentRecords: [],
          loadedRecords: payload.records || []
        })
      });
    });

    await page.locator(".merge-submit-button").click();
    await page.locator(".merge-review-panel").waitFor({ state: "visible", timeout: 10000 });
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.querySelector(".group-item-main")?.scrollIntoView({ block: "start", behavior: "instant" });
      document.querySelector(".merge-review-panel")?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    await page.waitForTimeout(200);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: false });
    process.stdout.write(`${outPath}\n`);
  } finally {
    await page.unroute("**/api/salesforce/premerge-check").catch(() => {});
    await browser.close();
  }
}

function captureProcessLogs(processHandle) {
  const lines = [];
  const append = (streamName, chunk) => {
    String(chunk || "").split(/\r?\n/).filter(Boolean).forEach((line) => {
      lines.push(`[server ${streamName}] ${line}`);
      if (lines.length > 120) lines.shift();
    });
  };

  processHandle.stdout.on("data", (chunk) => append("stdout", chunk));
  processHandle.stderr.on("data", (chunk) => append("stderr", chunk));
  return lines;
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

async function waitForReady(baseUrl, processHandle, logs) {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Server exited before ready.\n${logs.join("\n")}`);
    }
    try {
      const health = await requestJson(`${baseUrl}${READY_PATH}`);
      if (health.appId !== APP_ID) throw new Error(`Unexpected app id: ${JSON.stringify(health)}`);
      return;
    } catch (error) {
      if (attempt === READY_ATTEMPTS) {
        throw new Error(`App did not become ready.\n${logs.join("\n")}\nLast error: ${error.message}`);
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

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
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
