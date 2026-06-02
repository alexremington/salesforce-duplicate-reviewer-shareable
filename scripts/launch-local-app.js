#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const APP_ID = "salesforce-duplicate-reviewer";
const APP_NAME = "Salesforce Duplicate Reviewer";
const DEFAULT_PORT = 5180;
const PORT_CANDIDATES = [5180, 5182, 5183, 5184, 5185, 5186, 5187, 5188, 5189, 5190];
const REQUIRED_HEALTH = {
  brandHeaderVersion: "shared-logo-contact-v1",
  latestStagingFiles: true,
  jsonDatasets: true,
  salesforceMerge: true,
  staticAssetRoot: true,
  svgStaticAssets: true
};
const STATIC_ASSETS = [
  ["index.html", "index.html"],
  ["redirect-file-mode.js", "redirect-file-mode.js"],
  ["app.js", "app.js"],
  ["matching-worker.js", "matching-worker.js"],
  ["styles.css", "styles.css"],
  ["vendor/managed-app/assets/politico-logo.svg", "vendor/managed-app/assets/politico-logo.svg"],
  ["vendor/managed-app/css/managed-app-base.css", "vendor/managed-app/css/managed-app-base.css"],
  ["vendor/managed-app/scripts/managed-worker-client.js", "vendor/managed-app/scripts/managed-worker-client.js"]
];

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  loadDotEnv(path.join(PROJECT_DIR, ".env"));

  const configuredPort = String(process.env.DUPLICATE_REVIEWER_PORT || process.env.PORT || "").trim();
  const appSupportDir = process.env.DUPLICATE_REVIEWER_APP_SUPPORT_DIR || defaultAppSupportDir();
  const staticDir = process.env.DUPLICATE_REVIEWER_STATIC_DIR || path.join(appSupportDir, "static");
  const logDir = process.env.DUPLICATE_REVIEWER_LOG_DIR || defaultLogRoot();

  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  syncStaticAssets(staticDir);

  const port = await selectPort({ configuredPort });
  const url = `http://127.0.0.1:${port}`;
  const env = launchEnvironment({ port, staticDir });

  if (!(await isPortListening(port))) {
    console.log(`Starting ${APP_NAME}...`);
    startServer({ logDir, env });
  } else if (await reviewerReady(port)) {
    console.log(`${APP_NAME} is already running.`);
  } else if (await reviewerMatchesApp(port)) {
    console.log(`Restarting ${APP_NAME} to load the current runtime.`);
    await stopPortProcess(port);
    startServer({ logDir, env });
  } else {
    throw new Error(`Port ${port} is already in use by a different local process. Stop that process or set DUPLICATE_REVIEWER_PORT in .env.`);
  }

  console.log(`Waiting for ${url}...`);
  await waitForReady({ port, logDir });
  console.log(`Opening ${url}`);
  await openUrl(url);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 1) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function syncStaticAssets(staticDir) {
  for (const [sourceRelative, targetRelative] of STATIC_ASSETS) {
    copyStaticAsset(
      path.join(PROJECT_DIR, sourceRelative),
      path.join(staticDir, targetRelative)
    );
  }
}

function copyStaticAsset(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.copyFileSync(source, target);
  } catch (error) {
    if (fs.existsSync(target)) {
      console.warn(`Warning: could not refresh ${target}; keeping existing cached copy.`);
      return;
    }
    throw error;
  }
}

function launchEnvironment({ port, staticDir }) {
  const defaultPath = defaultCommandPath();
  return {
    ...process.env,
    ...(defaultPath ? { PATH: defaultPath, Path: process.platform === "win32" ? defaultPath : process.env.Path } : {}),
    ...(process.platform === "win32" ? {} : { SF_USE_GENERIC_UNIX_KEYCHAIN: process.env.SF_USE_GENERIC_UNIX_KEYCHAIN || "true" }),
    DUPLICATE_REVIEWER_PORT: String(port),
    PORT: String(port),
    DUPLICATE_REVIEWER_STATIC_DIR: staticDir
  };
}

async function selectPort({ configuredPort }) {
  if (configuredPort) return Number(configuredPort);

  for (const port of PORT_CANDIDATES) {
    if ((await reviewerMatchesApp(port)) || !(await isPortListening(port))) {
      return port;
    }
  }

  throw new Error("No Duplicate Reviewer port is available. Set DUPLICATE_REVIEWER_PORT in .env.");
}

async function reviewerReady(port) {
  const health = await reviewerHealth(port);
  if (!health) return false;
  return (
    reviewerHealthMatchesApp(health) &&
    health.brandHeaderVersion === REQUIRED_HEALTH.brandHeaderVersion &&
    health.latestStagingFiles === REQUIRED_HEALTH.latestStagingFiles &&
    health.jsonDatasets === REQUIRED_HEALTH.jsonDatasets &&
    health.salesforceMerge === REQUIRED_HEALTH.salesforceMerge &&
    health.staticAssetRoot === REQUIRED_HEALTH.staticAssetRoot &&
    health.svgStaticAssets === REQUIRED_HEALTH.svgStaticAssets
  );
}

async function reviewerMatchesApp(port) {
  const health = await reviewerHealth(port);
  return Boolean(health && reviewerHealthMatchesApp(health));
}

function reviewerHealthMatchesApp(health) {
  return health.appId === APP_ID || health.salesforceMerge === true;
}

function reviewerHealth(port) {
  return requestJson(`http://127.0.0.1:${port}/api/health`).catch(() => null);
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

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function startServer({ logDir, env }) {
  const outFd = fs.openSync(path.join(logDir, "duplicate-reviewer.out.log"), "a");
  const errFd = fs.openSync(path.join(logDir, "duplicate-reviewer.err.log"), "a");
  const child = childProcess.spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_DIR,
    env,
    detached: true,
    stdio: ["ignore", outFd, errFd],
    windowsHide: true
  });
  fs.writeFileSync(path.join(logDir, "duplicate-reviewer.pid"), `${child.pid}\n`);
  child.unref();
  fs.closeSync(outFd);
  fs.closeSync(errFd);
}

async function waitForReady({ port, logDir }) {
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    if (await reviewerReady(port)) return;
    await delay(250);
  }

  throw new Error([
    `${APP_NAME} did not become ready in time.`,
    `Stdout: ${path.join(logDir, "duplicate-reviewer.out.log")}`,
    recentLogText(path.join(logDir, "duplicate-reviewer.out.log")),
    "",
    `Stderr: ${path.join(logDir, "duplicate-reviewer.err.log")}`,
    recentLogText(path.join(logDir, "duplicate-reviewer.err.log"))
  ].join("\n"));
}

async function stopPortProcess(port) {
  const health = await reviewerHealth(port);
  const pid = Number(health?.pid) || await pidForPort(port);
  if (!pid) return;

  if (process.platform === "win32") {
    childProcess.spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    if (!(await isPortListening(port))) return;
    await delay(250);
  }

  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between checks.
    }
  }
}

async function pidForPort(port) {
  if (process.platform === "win32") {
    const result = childProcess.spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`
    ], { encoding: "utf8" });
    return Number(String(result.stdout || "").trim()) || null;
  }

  const result = childProcess.spawnSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN", "-n", "-P"], { encoding: "utf8" });
  return Number(String(result.stdout || "").trim().split(/\s+/)[0]) || null;
}

async function openUrl(url) {
  if (process.env.DUPLICATE_REVIEWER_NO_OPEN === "1") return;

  if (process.platform === "darwin") {
    childProcess.spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (process.platform === "win32") {
    childProcess.spawn("cmd.exe", ["/d", "/s", "/c", "start", '""', url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }

  childProcess.spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function recentLogText(filePath) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").trimEnd().split(/\r?\n/);
    return lines.slice(-30).join("\n") || "(log file is empty)";
  } catch {
    return "(log file not created)";
  }
}

function defaultCommandPath() {
  if (process.platform === "win32") {
    return uniquePathParts([
      process.env.Path,
      process.env.PATH,
      path.dirname(process.execPath),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "nodejs"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "nodejs"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "sf", "bin"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Salesforce CLI", "bin"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "sf", "bin"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Salesforce CLI", "bin"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "sf", "bin"),
      process.env.APPDATA && path.join(process.env.APPDATA, "npm"),
      path.join(os.homedir(), "AppData", "Roaming", "npm")
    ].filter(Boolean).join(path.delimiter)).join(path.delimiter);
  }

  return uniquePathParts([
    process.env.PATH,
    "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  ].filter(Boolean).join(path.delimiter)).join(path.delimiter);
}

function uniquePathParts(value) {
  const seen = new Set();
  const parts = [];
  for (const rawPart of String(value || "").split(path.delimiter)) {
    const part = rawPart.trim();
    const key = process.platform === "win32" ? part.toLowerCase() : part;
    if (!part || seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts;
}

function defaultAppSupportDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "salesforce-duplicate-reviewer");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Salesforce Duplicate Reviewer");
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "salesforce-duplicate-reviewer");
}

function defaultLogRoot() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", "salesforce-duplicate-reviewer");
  }

  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Salesforce Duplicate Reviewer", "Logs");
  }

  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "salesforce-duplicate-reviewer", "logs");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
