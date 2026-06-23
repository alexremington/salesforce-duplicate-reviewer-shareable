#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CANONICAL_PROD_ROOT = defaultProdRoot();
const DEFAULT_OUTPUT_KEY = "prod-contacts";
const DEFAULT_LATEST_CSV_NAME = "salesforce-report-latest.csv";
const DEFAULT_LATEST_JSON_NAME = "salesforce-report-latest.json";

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

async function main() {
  const result = await validateCanonicalProdContactsOutput();
  if (!result.validated) {
    console.error(
      `Canonical prod Contacts output is incomplete: ${result.reason}. ` +
      `Expected ${result.canonicalJsonPath} and ${result.canonicalCsvPath}.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Canonical prod Contacts output is ready at ${result.canonicalOutDir}.`);
}

async function validateCanonicalProdContactsOutput(options = {}) {
  const env = options.env || process.env;
  const fsApi = options.fs || fs;
  const paths = resolveProdContactsPaths(env);

  const canonicalJsonExists = await pathExists(fsApi, paths.canonicalJsonPath);
  const canonicalCsvExists = await pathExists(fsApi, paths.canonicalCsvPath);

  if (canonicalJsonExists && canonicalCsvExists) {
    return { validated: true, reason: "canonical-present", ...paths };
  }

  if (!canonicalJsonExists && !canonicalCsvExists) {
    return { validated: false, reason: "canonical-missing", ...paths };
  }

  if (!canonicalJsonExists) {
    return { validated: false, reason: "canonical-json-missing", ...paths };
  }

  return { validated: false, reason: "canonical-csv-missing", ...paths };
}

function resolveProdContactsPaths(env = process.env) {
  const canonicalProdRoot = normalizeConfiguredPath(env.DUPLICATE_REVIEWER_PROD_ROOT || DEFAULT_CANONICAL_PROD_ROOT);
  const outputKey = String(env.DUPLICATE_REVIEWER_PROD_OUTPUT_KEY || DEFAULT_OUTPUT_KEY).trim() || DEFAULT_OUTPUT_KEY;
  const latestCsvName = String(env.LATEST_CSV_NAME || DEFAULT_LATEST_CSV_NAME).trim() || DEFAULT_LATEST_CSV_NAME;
  const latestJsonName = String(env.LATEST_JSON_NAME || DEFAULT_LATEST_JSON_NAME).trim() || DEFAULT_LATEST_JSON_NAME;

  return {
    canonicalProdRoot,
    canonicalOutDir: path.join(canonicalProdRoot, "Output", outputKey),
    canonicalCsvPath: path.join(canonicalProdRoot, "Output", outputKey, latestCsvName),
    canonicalJsonPath: path.join(canonicalProdRoot, "Output", outputKey, latestJsonName)
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
    return path.join(os.homedir(), "Salesforce Pulls", "Duplicate Reviewer", "prod");
  }

  return path.join(
    os.homedir(),
    "Salesforce Pulls",
    "Duplicate Reviewer",
    "prod"
  );
}

module.exports = {
  validateCanonicalProdContactsOutput,
  resolveProdContactsPaths
};
