#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CANONICAL_PROD_ROOT = defaultProdRoot();
const DEFAULT_LEGACY_PROD_ROOT = path.join(
  path.dirname(DEFAULT_CANONICAL_PROD_ROOT),
  "download-prod-contacts-for-duplicate-review"
);
const DEFAULT_OUTPUT_KEY = "prod-contacts";
const DEFAULT_LATEST_CSV_NAME = "salesforce-prod-contacts-latest.csv";
const DEFAULT_LATEST_JSON_NAME = "salesforce-prod-contacts-latest.json";

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  const result = await repairLegacyProdContactsOutput();
  if (result.repaired) {
    console.log(`Repaired legacy prod Contacts output from ${result.from} to ${result.to}.`);
  }
}

async function repairLegacyProdContactsOutput(options = {}) {
  const env = options.env || process.env;
  const fsApi = options.fs || fs;
  const paths = resolveProdContactsPaths(env);

  if (await pathExists(fsApi, paths.canonicalJsonPath)) {
    return { repaired: false, reason: "canonical-present", ...paths };
  }

  if (!(await pathExists(fsApi, paths.legacyOutDir))) {
    return { repaired: false, reason: "legacy-missing", ...paths };
  }

  await fsApi.mkdir(paths.canonicalOutDir, { recursive: true });
  await fsApi.cp(paths.legacyOutDir, paths.canonicalOutDir, {
    recursive: true,
    force: true,
    preserveTimestamps: true
  });

  return {
    repaired: true,
    from: paths.legacyOutDir,
    to: paths.canonicalOutDir,
    ...paths
  };
}

function resolveProdContactsPaths(env = process.env) {
  const canonicalProdRoot = normalizeConfiguredPath(env.DUPLICATE_REVIEWER_PROD_ROOT || DEFAULT_CANONICAL_PROD_ROOT);
  const legacyProdRoot = normalizeConfiguredPath(env.LEGACY_DUPLICATE_REVIEWER_PROD_ROOT || DEFAULT_LEGACY_PROD_ROOT);
  const outputKey = String(env.DUPLICATE_REVIEWER_PROD_OUTPUT_KEY || DEFAULT_OUTPUT_KEY).trim() || DEFAULT_OUTPUT_KEY;
  const latestCsvName = String(env.LATEST_CSV_NAME || DEFAULT_LATEST_CSV_NAME).trim() || DEFAULT_LATEST_CSV_NAME;
  const latestJsonName = String(env.LATEST_JSON_NAME || DEFAULT_LATEST_JSON_NAME).trim() || DEFAULT_LATEST_JSON_NAME;

  return {
    canonicalProdRoot,
    canonicalOutDir: path.join(canonicalProdRoot, "Output", outputKey),
    canonicalCsvPath: path.join(canonicalProdRoot, "Output", outputKey, latestCsvName),
    canonicalJsonPath: path.join(canonicalProdRoot, "Output", outputKey, latestJsonName),
    legacyProdRoot,
    legacyOutDir: path.join(legacyProdRoot, "Output", "download-prod-contacts-for-duplicate-review"),
    legacyCsvPath: path.join(legacyProdRoot, "Output", "download-prod-contacts-for-duplicate-review", latestCsvName),
    legacyJsonPath: path.join(legacyProdRoot, "Output", "download-prod-contacts-for-duplicate-review", latestJsonName)
  };
}

function normalizeConfiguredPath(value) {
  return path.normalize(path.resolve(String(value || "").trim()));
}

async function pathExists(fsApi, filePath) {
  try {
    await fsApi.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function defaultProdRoot() {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "OneDrive - POLITICO", "Salesforce Pulls", "Duplicate Reviewer", "prod");
  }

  return path.join(
    os.homedir(),
    "Library",
    "CloudStorage",
    "OneDrive-POLITICO",
    "Automation Projects",
    "Salesforce Pulls",
    "Duplicate Reviewer",
    "prod"
  );
}

module.exports = {
  repairLegacyProdContactsOutput,
  resolveProdContactsPaths
};
