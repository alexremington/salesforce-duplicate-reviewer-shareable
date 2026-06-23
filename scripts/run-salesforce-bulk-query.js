#!/usr/bin/env node

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const managedPlatform = require("../vendor/managed-app/scripts/platform");

const PROJECT_DIR = path.resolve(__dirname, "..");
const DEFAULT_ORG_ALIAS = "qa-staging";
const DEFAULT_INSTANCE_URL = "https://qa-staging.example.invalid";
const DEFAULT_API_VERSION = "v67.0";
const DEFAULT_CSV_NAME = "salesforce-report-latest.csv";
const DEFAULT_JSON_NAME = "salesforce-report-latest.json";
const CACHE_TTL_MS = 2 * 60 * 1000;
const LOCK_WAIT_MS = 1000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const RUNTIME_ENV = managedPlatform.withCommandPath(
  process.env,
  managedPlatform.defaultCommandPath({ env: process.env, platform: process.platform, includeSalesforceCli: true }),
  process.platform
);

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  loadDotEnv(path.join(PROJECT_DIR, ".env"));

  const args = parseArgs(process.argv.slice(2));
  const objectType = args.objectType || process.env.OBJECT_TYPE || "";
  const outDir = normalizeConfiguredPath(args.outDir || process.env.OUT_DIR || defaultOutputDir(objectType));
  const latestCsvName = String(args.latestCsvName || process.env.LATEST_CSV_NAME || DEFAULT_CSV_NAME);
  const latestJsonName = String(args.latestJsonName || process.env.LATEST_JSON_NAME || DEFAULT_JSON_NAME);
  const orgAlias = String(args.orgAlias || process.env.SF_ORG_ALIAS || DEFAULT_ORG_ALIAS).trim();
  const instanceUrl = String(args.instanceUrl || process.env.SF_INSTANCE_URL || DEFAULT_INSTANCE_URL).trim();
  const apiVersion = String(args.apiVersion || process.env.SF_API_VERSION || DEFAULT_API_VERSION).trim();
  const pollMs = String(args.pollMs || process.env.BULK_POLL_MS || 5000);
  const queryFile = normalizeConfiguredPath(args.queryFile || process.env.SF_SOQL_FILE || "");
  const queryAll = Boolean(args.queryAll);

  if (!queryFile) throw new Error("Missing SOQL file. Set SF_SOQL_FILE or pass --query-file.");

  const queryText = normalizeSoql(await fsPromises.readFile(queryFile, "utf8"));
  const sourceSignature = signatureFor({
    objectType,
    orgAlias,
    instanceUrl,
    apiVersion,
    queryText,
    queryAll
  });
  const cacheDir = path.join(outDir, ".pull-cache");
  const manifestPath = path.join(cacheDir, `${sourceSignature}.json`);
  const lockPath = path.join(cacheDir, `${sourceSignature}.lock`);
  const latestCsvPath = path.join(outDir, latestCsvName);
  const latestJsonPath = path.join(outDir, latestJsonName);

  await fsPromises.mkdir(cacheDir, { recursive: true });
  await fsPromises.mkdir(path.dirname(latestCsvPath), { recursive: true });

  if (await tryReuseCachedPull({ manifestPath, latestCsvPath, latestJsonPath })) {
    return;
  }

  const lockHandle = await acquirePullLock(lockPath);
  try {
    if (await tryReuseCachedPull({ manifestPath, latestCsvPath, latestJsonPath })) {
      return;
    }

    const resolvedOrg = await resolveCanonicalOrg({ orgAlias, instanceUrl });
    const accessToken = await fetchAccessToken(resolvedOrg.alias);
    if (process.env.DUPLICATE_REVIEWER_SKIP_BULK_QUERY === "1") {
      await writeSyntheticPullOutputs(latestCsvPath, latestJsonPath);
    } else {
      await runBulkQuery({
        accessToken,
        instanceUrl: resolvedOrg.instanceUrl,
        apiVersion,
        queryFile,
        latestCsvPath,
        latestJsonPath,
        pollMs,
        queryAll
      });
    }

    await writeCacheManifest(manifestPath, {
      sourceSignature,
      createdAt: new Date().toISOString(),
      orgAlias: resolvedOrg.alias,
      instanceUrl: resolvedOrg.instanceUrl,
      apiVersion,
      queryFile: path.resolve(queryFile),
      latestCsvPath,
      latestJsonPath
    });
    console.log(`Resolved canonical org ${resolvedOrg.alias} at ${resolvedOrg.instanceUrl}`);
  } finally {
    await releasePullLock(lockHandle, lockPath);
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--query-file") {
      parsed.queryFile = requiredValue(args, ++index, arg);
    } else if (arg === "--source-csv") {
      parsed.sourceCsv = requiredValue(args, ++index, arg);
    } else if (arg === "--out-dir") {
      parsed.outDir = requiredValue(args, ++index, arg);
    } else if (arg === "--latest-csv-name") {
      parsed.latestCsvName = requiredValue(args, ++index, arg);
    } else if (arg === "--latest-json-name") {
      parsed.latestJsonName = requiredValue(args, ++index, arg);
    } else if (arg === "--org-alias") {
      parsed.orgAlias = requiredValue(args, ++index, arg);
    } else if (arg === "--instance-url") {
      parsed.instanceUrl = requiredValue(args, ++index, arg);
    } else if (arg === "--api-version") {
      parsed.apiVersion = requiredValue(args, ++index, arg);
    } else if (arg === "--poll-ms") {
      parsed.pollMs = requiredValue(args, ++index, arg);
    } else if (arg === "--query-all") {
      parsed.queryAll = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.dryRun) {
    printDryRun(parsed);
    process.exit(0);
  }

  return parsed;
}

function printDryRun(parsed) {
  const objectType = normalizeObjectType(process.env.OBJECT_TYPE || "") || "contact";
  const outDir = normalizeConfiguredPath(parsed.outDir || process.env.OUT_DIR || defaultOutputDir(objectType));
  const queryFile = normalizeConfiguredPath(parsed.queryFile || process.env.SF_SOQL_FILE || defaultQueryFile(objectType));
  const latestCsvName = String(parsed.latestCsvName || process.env.LATEST_CSV_NAME || DEFAULT_CSV_NAME);
  const latestJsonName = String(parsed.latestJsonName || process.env.LATEST_JSON_NAME || DEFAULT_JSON_NAME);

  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Output: ${outDir}`);
  console.log(`Org alias: ${String(parsed.orgAlias || process.env.SF_ORG_ALIAS || DEFAULT_ORG_ALIAS)}`);
  console.log(`Instance: ${String(parsed.instanceUrl || process.env.SF_INSTANCE_URL || DEFAULT_INSTANCE_URL)}`);
  console.log(`API version: ${String(parsed.apiVersion || process.env.SF_API_VERSION || DEFAULT_API_VERSION)}`);
  console.log(`Report metadata source: ${path.basename(queryFile, path.extname(queryFile))}`);
  console.log(`SOQL file: ${queryFile}`);
  console.log(`Fetch mode: Bulk API CSV transport with JSON latest output`);
  console.log(`Latest JSON: ${path.join(outDir, latestJsonName)}`);
  console.log(`Compatibility CSV: ${path.join(outDir, latestCsvName)}`);
  console.log(`Bulk poll interval ms: ${String(parsed.pollMs || process.env.BULK_POLL_MS || 5000)}`);
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

async function tryReuseCachedPull({ manifestPath, latestCsvPath, latestJsonPath }) {
  try {
    const raw = await fsPromises.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    if (Date.now() - Date.parse(manifest.createdAt || 0) > CACHE_TTL_MS) return false;
    if (!manifest.latestCsvPath || !manifest.latestJsonPath) return false;
    await Promise.all([
      fsPromises.access(latestCsvPath, fs.constants.F_OK),
      fsPromises.access(latestJsonPath, fs.constants.F_OK)
    ]);
    console.log(`Reusing recent Salesforce pull for ${manifest.orgAlias} (${manifest.instanceUrl}).`);
    return true;
  } catch {
    return false;
  }
}

async function acquirePullLock(lockPath) {
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await fsPromises.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
      return handle;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for an in-flight Salesforce pull to finish.");
      }
      await wait(LOCK_WAIT_MS);
    }
  }
}

async function releasePullLock(handle, lockPath) {
  try {
    if (handle) await handle.close();
  } finally {
    await fsPromises.rm(lockPath, { force: true }).catch(() => {});
  }
}

async function resolveCanonicalOrg({ orgAlias, instanceUrl }) {
  const requestedInstanceUrl = normalizeInstanceUrl(instanceUrl);
  const requestedAlias = String(orgAlias || DEFAULT_ORG_ALIAS).trim() || DEFAULT_ORG_ALIAS;
  const orgList = await fetchSalesforceOrgList();
  const canonicalAlias = canonicalSalesforceOrgAlias(requestedAlias, requestedInstanceUrl);
  const aliasMatch = orgList.find((org) => org.alias === canonicalAlias);
  return aliasMatch || {
    alias: canonicalAlias,
    instanceUrl: requestedInstanceUrl
  };
}

async function fetchSalesforceOrgList() {
  try {
    const payload = await execFileJson(salesforceCliCommand(), ["org", "list", "--json"], { env: salesforceCliEnv() });
    return salesforceOrgsFromListPayload(payload);
  } catch {
    return [];
  }
}

async function fetchAccessToken(orgAlias) {
  const result = await execFileJson(salesforceCliCommand(), ["org", "auth", "show-access-token", "--target-org", orgAlias, "--json"], {
    env: salesforceCliEnv()
  });
  const token = String(result?.result?.accessToken || result?.result?.token || "").trim();
  if (!token) throw new Error(`Could not read Salesforce access token from sf org auth show-access-token for ${orgAlias}.`);
  return token;
}

async function runBulkQuery({ accessToken, instanceUrl, apiVersion, queryFile, latestCsvPath, latestJsonPath, pollMs, queryAll }) {
  const commonEnv = {
    ...RUNTIME_ENV,
    SF_ACCESS_TOKEN: accessToken,
    SF_INSTANCE_URL: instanceUrl,
    SF_API_VERSION: apiVersion
  };
  const queryArgs = [
    "--instance", instanceUrl,
    "--api-version", apiVersion,
    "--query-file", queryFile,
    "--out", latestCsvPath,
    "--poll-ms", pollMs
  ];
  if (queryAll) queryArgs.push("--query-all");
  runNodeScript("scripts/fetch-salesforce-bulk-query.js", commonEnv, queryArgs);

  runNodeScript("scripts/csv-to-salesforce-json.js", RUNTIME_ENV, [
    "--input", latestCsvPath,
    "--output", latestJsonPath
  ]);
}

async function writeCacheManifest(manifestPath, manifest) {
  await fsPromises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeSyntheticPullOutputs(latestCsvPath, latestJsonPath) {
  const csv = [
    "Id,Name,Email",
    "003T00000090001,Smoke Record,smoke@example.com",
    "003T00000090002,Smoke Record Copy,smoke@example.com"
  ].join("\n");
  await fsPromises.writeFile(latestCsvPath, `${csv}\n`);
  runNodeScript("scripts/csv-to-salesforce-json.js", RUNTIME_ENV, [
    "--input", latestCsvPath,
    "--output", latestJsonPath
  ]);
}

function execFileJson(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, {
      maxBuffer: 10 * 1024 * 1024,
      ...options,
      env: {
        ...(options.env || process.env)
      }
    }, (error, stdout, stderr) => {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed && (parsed.status === 0 || parsed.status === "0" || parsed.result)) {
          resolve(parsed);
          return;
        }
        if (error) {
          reject(new Error(String(stderr || stdout || error.message || "Salesforce CLI command failed").trim()));
          return;
        }
        resolve(parsed);
      } catch (parseError) {
        if (error) {
          reject(new Error(String(stderr || stdout || error.message || "Salesforce CLI command failed").trim()));
          return;
        }
        reject(parseError);
      }
    });
  });
}

function salesforceOrgsFromListPayload(payload) {
  const result = payload.result || payload;
  const candidates = [
    result.nonScratchOrgs,
    result.scratchOrgs,
    result.sandboxes,
    result.devHubs,
    result.orgs
  ].filter(Array.isArray).flat();
  const byAlias = new Map();

  for (const candidate of candidates) {
    const org = salesforceOrgRecord(candidate);
    if (!org.alias || !org.instanceUrl) continue;
    if (candidate.isExpired === true) continue;
    if (org.connectedStatus && !/connected/i.test(org.connectedStatus)) continue;
    byAlias.set(org.alias, org);
  }

  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}

function salesforceOrgRecord(org) {
  return {
    alias: canonicalSalesforceOrgAlias(org.alias || org.username || "", org.instanceUrl || ""),
    instanceUrl: normalizeInstanceUrl(org.instanceUrl || ""),
    username: String(org.username || "").trim(),
    orgId: String(org.id || org.orgId || "").trim(),
    connectedStatus: String(org.connectedStatus || org.status || "").trim()
  };
}

function canonicalSalesforceOrgAlias(value, instanceUrl = "") {
  const alias = String(value || "").trim();
  if (!alias) return "";
  if (alias.toLowerCase() !== "staging") return alias;
  return isCanonicalStagingSandboxInstanceUrl(instanceUrl) ? "qa-staging" : alias;
}

function isCanonicalStagingSandboxInstanceUrl(value) {
  return normalizeInstanceUrl(value || "") === normalizeInstanceUrl(DEFAULT_INSTANCE_URL);
}

function normalizeInstanceUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const url = new URL(text);
  if (url.hostname.endsWith(".lightning.force.com")) {
    url.hostname = url.hostname.replace(".lightning.force.com", ".my.salesforce.com");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeSoql(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function signatureFor(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runNodeScript(scriptRelativePath, extraEnv, args) {
  const scriptPath = path.join(PROJECT_DIR, scriptRelativePath);
  const result = childProcess.spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: PROJECT_DIR,
    env: { ...RUNTIME_ENV, ...extraEnv },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptRelativePath)} failed.`);
  }
}

function salesforceCliCommand() {
  return String(process.env.SF_CLI_BIN || "").trim() || managedPlatform.resolveExecutable("sf", {
    env: RUNTIME_ENV,
    platform: process.platform
  }) || "sf";
}

function salesforceCliEnv() {
  return {
    ...RUNTIME_ENV,
    SF_USE_GENERIC_UNIX_KEYCHAIN: process.env.SF_USE_GENERIC_UNIX_KEYCHAIN || "true"
  };
}

function defaultOutputDir(objectType) {
  const normalized = normalizeObjectType(objectType) || "contact";
  return path.join(PROJECT_DIR, "Output", `staging-${normalized === "contact" ? "contacts" : "accounts"}`);
}

function defaultQueryFile(objectType) {
  const normalized = normalizeObjectType(objectType) || "contact";
  return path.join(
    PROJECT_DIR,
    "queries",
    normalized === "contact" ? "contact-duplicate-record-items.soql" : "account-duplicate-record-items.soql"
  );
}

function normalizeConfiguredPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\")) {
    return text.replace(/\\/g, "/");
  }
  if (path.isAbsolute(text)) return text;
  return path.resolve(PROJECT_DIR, text);
}

function normalizeObjectType(objectType) {
  const normalized = String(objectType || "").trim().toLowerCase();
  if (normalized === "contact" || normalized === "account") return normalized;
  return "";
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
