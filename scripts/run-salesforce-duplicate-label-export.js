#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline/promises");
const managedPlatform = require("../vendor/managed-app/scripts/platform");

const PROJECT_DIR = path.resolve(__dirname, "..");
const DEFAULT_ORG_ALIAS = "politico";
const DEFAULT_INSTANCE_URL = "https://your-org.my.salesforce.com";
const DEFAULT_API_VERSION = "v64.0";
const DUPLICATE_ITEMS_CSV_NAME = "salesforce-duplicate-record-items-latest.csv";
const DUPLICATE_ITEMS_JSON_NAME = "salesforce-duplicate-record-items-latest.json";
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
  const objectType = normalizeObjectType(args.objectType || process.env.OBJECT_TYPE || "");
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const sourceCsv = args.sourceCsv || process.env.SOURCE_CSV || existingDefaultSourceCsv(objectType) || (interactive ? await prompt("Path to source CSV: ") : "");
  const outputFile = args.outputFile || process.env.OUTPUT_FILE || defaultOutputFile(objectType);
  const duplicateItemsDir = args.duplicateItemsDir || process.env.DUPLICATE_ITEMS_DIR || defaultDuplicateItemsDir(objectType);
  const orgAlias = process.env.SF_ORG_ALIAS || DEFAULT_ORG_ALIAS;
  const instanceUrl = process.env.SF_INSTANCE_URL || DEFAULT_INSTANCE_URL;
  const apiVersion = process.env.SF_API_VERSION || DEFAULT_API_VERSION;
  const queryFile = resolveQueryFile(objectType);
  const pollMs = String(process.env.BULK_POLL_MS || 60000);

  if (!objectType) {
    if (!interactive) throw new Error("Missing or unsupported object type. Pass --object account or --object contact.");
    const promptedObjectType = normalizeObjectType((await prompt("Object type [account/contact] (default: account): ")) || "account");
    if (!promptedObjectType) throw new Error("Missing or unsupported object type. Pass --object account or --object contact.");
    return runExport({
      objectType: promptedObjectType,
      sourceCsv: sourceCsv || existingDefaultSourceCsv(promptedObjectType) || (await prompt("Path to source CSV: ")),
      outputFile,
      duplicateItemsDir,
      orgAlias,
      instanceUrl,
      apiVersion,
    queryFile: resolveQueryFile(promptedObjectType),
      pollMs
    });
  }

  if (!sourceCsv) {
    if (!interactive) {
      throw new Error("Missing source CSV. Pass --source /path/to/accounts.csv or set SOURCE_CSV.");
    }
  }

  await runExport({
    objectType,
    sourceCsv: sourceCsv || existingDefaultSourceCsv(objectType) || (await prompt("Path to source CSV: ")),
    outputFile,
    duplicateItemsDir,
    orgAlias,
    instanceUrl,
    apiVersion,
    queryFile,
    pollMs
  });
}

async function runExport({
  objectType,
  sourceCsv,
  outputFile,
  duplicateItemsDir,
  orgAlias,
  instanceUrl,
  apiVersion,
  queryFile,
  pollMs
}) {
  const sourcePath = path.resolve(String(sourceCsv || "").trim());
  if (!sourcePath) throw new Error("Missing source CSV path.");
  if (!fs.existsSync(sourcePath)) throw new Error(`Source CSV not found: ${sourcePath}`);

  const outputPath = path.resolve(String(outputFile || "").trim() || defaultOutputFile(objectType));
  const duplicateDir = path.resolve(String(duplicateItemsDir || "").trim() || defaultDuplicateItemsDir(objectType));
  const latestCsvPath = path.join(duplicateDir, DUPLICATE_ITEMS_CSV_NAME);
  const latestJsonPath = path.join(duplicateDir, DUPLICATE_ITEMS_JSON_NAME);

  fs.mkdirSync(duplicateDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  console.log(`Object type: ${objectType}`);
  console.log(`Source CSV: ${sourcePath}`);
  console.log(`Duplicate-items output dir: ${duplicateDir}`);
  console.log(`Labels output: ${outputPath}`);

  const accessToken = fetchSalesforceAccessToken(orgAlias);
  runNodeScript("scripts/fetch-salesforce-bulk-query.js", {
    ...RUNTIME_ENV,
    SF_ACCESS_TOKEN: accessToken,
    SF_INSTANCE_URL: instanceUrl,
    SF_API_VERSION: apiVersion
  }, [
    "--instance", instanceUrl,
    "--api-version", apiVersion,
    "--query-file", queryFile,
    "--out", latestCsvPath,
    "--poll-ms", pollMs
  ]);

  runNodeScript("scripts/csv-to-salesforce-json.js", RUNTIME_ENV, [
    "--input", latestCsvPath,
    "--output", latestJsonPath
  ]);

  runNodeScript("scripts/export-salesforce-duplicate-training-labels.js", RUNTIME_ENV, [
    "--duplicate-items", latestCsvPath,
    "--source", sourcePath,
    "--object", objectType,
    "--output", outputPath
  ]);

  console.log(`Saved ${objectType === "contact" ? "Contact" : "Account"} duplicate training labels to ${outputPath}`);
  console.log(`Latest duplicate-items CSV: ${latestCsvPath}`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--object") {
      parsed.objectType = args[index + 1];
      index += 1;
    } else if (arg === "--source") {
      parsed.sourceCsv = args[index + 1];
      index += 1;
    } else if (arg === "--output") {
      parsed.outputFile = args[index + 1];
      index += 1;
    } else if (arg === "--duplicate-items-dir") {
      parsed.duplicateItemsDir = args[index + 1];
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
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
  const objectType = normalizeObjectType(parsed.objectType || process.env.OBJECT_TYPE || "") || "account";
  const duplicateItemsDir = parsed.duplicateItemsDir || process.env.DUPLICATE_ITEMS_DIR || defaultDuplicateItemsDir(objectType);
  const outputFile = parsed.outputFile || process.env.OUTPUT_FILE || defaultOutputFile(objectType);
  const sourceCsv = parsed.sourceCsv || process.env.SOURCE_CSV || defaultSourceCsv(objectType);
  const queryFile = resolveQueryFile(objectType);

  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Object type: ${objectType}`);
  console.log(`Org alias: ${process.env.SF_ORG_ALIAS || DEFAULT_ORG_ALIAS}`);
  console.log(`Instance: ${process.env.SF_INSTANCE_URL || DEFAULT_INSTANCE_URL}`);
  console.log(`API version: ${process.env.SF_API_VERSION || DEFAULT_API_VERSION}`);
  console.log(`SOQL file: ${queryFile}`);
  console.log(`Duplicate-items output dir: ${duplicateItemsDir}`);
  console.log(`Latest duplicate-items CSV: ${path.join(duplicateItemsDir, DUPLICATE_ITEMS_CSV_NAME)}`);
  console.log(`Source CSV: ${sourceCsv}`);
  console.log(`Labels output: ${outputFile}`);
}

function normalizeObjectType(objectType) {
  const value = String(objectType || "").trim().toLowerCase();
  if (value === "account" || value === "contact") return value;
  return "";
}

function defaultOutputFile(objectType) {
  return path.join(defaultOutputDir(objectType), `${objectType}-duplicate-training-labels.csv`);
}

function defaultDuplicateItemsDir(objectType) {
  return path.join(defaultOutputDir(objectType), "duplicate-items");
}

function defaultOutputDir(objectType) {
  return path.join(PROJECT_DIR, "Output", `${objectType}-duplicate-label-export`);
}

function defaultQueryFile(objectType) {
  return path.join(PROJECT_DIR, "queries", `${objectType}-duplicate-record-items.soql`);
}

function defaultQueryExampleFile(objectType) {
  return path.join(PROJECT_DIR, "queries", `${objectType}-duplicate-record-items.soql.example`);
}

function resolveQueryFile(objectType) {
  const explicit = process.env.SF_SOQL_FILE;
  if (explicit) return explicit;

  const candidates = [defaultQueryFile(objectType), defaultQueryExampleFile(objectType)];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return defaultQueryFile(objectType);
}

function defaultSourceCsv(objectType) {
  const resolvedObjectType = normalizeObjectType(objectType);
  if (!resolvedObjectType) return "";

  const envSource =
    resolvedObjectType === "contact" ? process.env.STAGING_CONTACTS_CSV : process.env.STAGING_ACCOUNTS_CSV;
  if (envSource) return envSource;

  const stagingRoot = process.env.DUPLICATE_REVIEWER_STAGING_ROOT || defaultStagingRoot();
  const outDir = path.join(stagingRoot, "Output", `staging-${resolvedObjectType === "contact" ? "contacts" : "accounts"}`);
  return path.join(outDir, "salesforce-report-latest.csv");
}

function existingDefaultSourceCsv(objectType) {
  const candidate = defaultSourceCsv(objectType);
  return candidate && fs.existsSync(candidate) ? candidate : "";
}

function defaultStagingRoot() {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "Salesforce Pulls", "Duplicate Reviewer", "staging");
  }

  return path.join(os.homedir(), "Salesforce Pulls", "Duplicate Reviewer", "staging");
}

function fetchSalesforceAccessToken(orgAlias) {
  const sfExecutable = managedPlatform.resolveExecutable("sf", {
    env: RUNTIME_ENV,
    platform: process.platform
  }) || "sf";
  const raw = childProcess.execFileSync(sfExecutable, ["org", "auth", "show-access-token", "--target-org", orgAlias, "--json"], {
    env: RUNTIME_ENV,
    encoding: "utf8"
  });
  const parsed = JSON.parse(raw);
  const result = parsed.result || {};
  const token = String(result.accessToken || result.token || "").trim();
  if (!token) throw new Error("Could not read Salesforce access token from sf org auth show-access-token.");
  return token;
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

async function prompt(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return String(await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}
