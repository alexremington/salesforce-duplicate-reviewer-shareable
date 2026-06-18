#!/usr/bin/env node

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");
const { buildCodexTrainingCommand } = require("./codex-training");
const managedPlatform = require("../vendor/managed-app/scripts/platform");

const ROOT_DIR = path.resolve(__dirname, "..");
loadDotEnv(path.join(ROOT_DIR, ".env"));
const STATIC_ROOT_DIR = path.resolve(process.env.DUPLICATE_REVIEWER_STATIC_DIR || path.join(ROOT_DIR, "public"));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.DUPLICATE_REVIEWER_PORT || process.env.PORT || 5180);
const OUTPUT_DIR = path.join(ROOT_DIR, "Output");
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_MODEL = process.env.CODEX_MODEL || "";
const CODEX_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || "";
const STAGING_CONTACTS_CSV =
  process.env.STAGING_CONTACTS_CSV ||
  path.join(OUTPUT_DIR, "staging-contacts", "salesforce-report-latest.csv");
const STAGING_ACCOUNTS_CSV =
  process.env.STAGING_ACCOUNTS_CSV ||
  path.join(OUTPUT_DIR, "staging-accounts", "salesforce-report-latest.csv");
const PROD_CONTACTS_CSV =
  process.env.PROD_CONTACTS_CSV ||
  defaultProdContactsCsvPath();
const PROD_ACCOUNTS_CSV =
  process.env.PROD_ACCOUNTS_CSV ||
  defaultProdAccountsCsvPath();
const STAGING_SF_ORG_ALIAS = process.env.SF_ORG_ALIAS || "politico-staging";
const STAGING_SF_INSTANCE_URL = process.env.SF_INSTANCE_URL || "https://politico--staging.sandbox.my.salesforce.com";
const PROD_SF_ORG_ALIAS = process.env.PROD_SF_ORG_ALIAS || "politico";
const PROD_SF_INSTANCE_URL = process.env.PROD_SF_INSTANCE_URL || "https://login.salesforce.com";
const SF_ORG_ALIAS = STAGING_SF_ORG_ALIAS;
const SF_INSTANCE_URL = STAGING_SF_INSTANCE_URL;
const SF_API_VERSION = process.env.SF_API_VERSION || "v67.0";
const SF_CLI_BIN = String(process.env.SF_CLI_BIN || "").trim();
const FEATURE_VERSION = "duplicate-reviewer-cli-warning-safe-v4";
const API_CONTRACT_VERSION = "duplicate-reviewer-api-contract-v2";
const DEFAULT_PATH = managedPlatform.defaultCommandPath();
const salesforceMergeService = createSalesforceMergeService();
let salesforceCliCommandCache = null;
const salesforceAuthCache = new Map();
const salesforceOrgListCache = new Map();
const SALESFORCE_AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const SALESFORCE_ORG_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const ENDPOINT_RESPONSE_CACHE_LIMIT = 8;
const HEALTH_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let healthState = {
  salesforceAuthFresh: false,
  salesforceAuthFreshCheckedAt: "",
  runtimeAligned: false,
  runtimeAlignedCheckedAt: ""
};
const endpointResponseCache = new Map();
const MERGE_AUDIT_LOG = path.join(OUTPUT_DIR, "salesforce-merge-log.jsonl");
const MERGE_REPORT_LATEST_CSV = path.join(OUTPUT_DIR, "salesforce-merge-report-latest.csv");
const MERGE_REPORT_LATEST_JSON = path.join(OUTPUT_DIR, "salesforce-merge-report-latest.json");
const MAX_MERGE_VICTIMS = 20;
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const MERGE_MASTER_FIELD_ALLOWLIST = new Set(["LeadSource"]);
const MERGE_MASTER_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const CONTACT_PREMERGE_SOQL_FIELDS = [
  "Id",
  "IsDeleted",
  "CreatedDate",
  "LastModifiedDate",
  "SystemModstamp",
  "Name",
  "FirstName",
  "LastName",
  "Email",
  "LeadSource",
  "Phone",
  "MobilePhone",
  "AccountId",
  "Account.Name"
];
const CONTACT_PREMERGE_COMPARISON_FIELDS = [
  ["fullName", "Full Name"],
  ["firstName", "First Name"],
  ["lastName", "Last Name"],
  ["company", "Company / Account"],
  ["email", "Email"],
  ["leadSource", "Lead Source"],
  ["phone", "Phone"],
  ["mobile", "Mobile"]
];
const RECOVERY_SNAPSHOT_FIELDS = [
  "Id",
  "Name",
  "FirstName",
  "LastName",
  "Email",
  "LeadSource",
  "Phone",
  "MobilePhone",
  "AccountId",
  "AccountName",
  "CreatedDate",
  "LastModifiedDate",
  "SystemModstamp",
  "IsDeleted"
];
const MERGE_REPORT_RECORD_HEADERS = [
  "Salesforce ID",
  "Name",
  "First Name",
  "Last Name",
  "Email",
  "Lead Source",
  "Phone",
  "Mobile Phone",
  "Account ID",
  "Account Name",
  "Created Date",
  "Last Modified Date",
  "System Modstamp",
  "Is Deleted"
];
const RUNTIME_ALIGNMENT_FILES = [
  "index.html",
  "redirect-file-mode.js",
  "app.js",
  "matching-worker.js",
  "styles.css"
];

const CSV_ENDPOINTS = new Map([
  [
    "/api/staging-contacts/latest.csv",
    {
      path: STAGING_CONTACTS_CSV,
      jsonPath: STAGING_CONTACTS_CSV.replace(/\.csv$/i, ".json"),
      fileName: "salesforce-report-latest.csv",
      objectType: "contact",
      label: "Latest Contacts",
      source: "staging-contacts",
      orgAlias: STAGING_SF_ORG_ALIAS,
      instanceUrl: STAGING_SF_INSTANCE_URL
    }
  ],
  [
    "/api/staging-accounts/latest.csv",
    {
      path: STAGING_ACCOUNTS_CSV,
      jsonPath: STAGING_ACCOUNTS_CSV.replace(/\.csv$/i, ".json"),
      fileName: "salesforce-report-latest.csv",
      objectType: "account",
      label: "Latest Accounts",
      source: "staging-accounts",
      orgAlias: STAGING_SF_ORG_ALIAS,
      instanceUrl: STAGING_SF_INSTANCE_URL
    }
  ],
  [
    "/api/prod-contacts/latest.csv",
    {
      path: PROD_CONTACTS_CSV,
      jsonPath: PROD_CONTACTS_CSV.replace(/\.csv$/i, ".json"),
      fileName: "salesforce-report-latest.csv",
      objectType: "contact",
      label: "Latest Prod Contacts",
      source: "prod-contacts",
      orgAlias: PROD_SF_ORG_ALIAS,
      instanceUrl: PROD_SF_INSTANCE_URL
    }
  ],
  [
    "/api/prod-accounts/latest.csv",
    {
      path: PROD_ACCOUNTS_CSV,
      jsonPath: PROD_ACCOUNTS_CSV.replace(/\.csv$/i, ".json"),
      fileName: "salesforce-report-latest.csv",
      objectType: "account",
      label: "Latest Prod Accounts",
      source: "prod-accounts",
      orgAlias: PROD_SF_ORG_ALIAS,
      instanceUrl: PROD_SF_INSTANCE_URL
    }
  ]
]);
const JSON_ENDPOINTS = new Map(
  [...CSV_ENDPOINTS.entries()].map(([endpointPath, endpoint]) => [
    endpointPath.replace(/\.csv$/i, ".json"),
    {
      ...endpoint,
      path: endpoint.jsonPath,
      csvPath: endpoint.path,
      fileName: endpoint.fileName.replace(/\.csv$/i, ".json")
    }
  ])
);

function defaultProdContactsCsvPath() {
  if (process.platform === "win32") {
    return path.join(
      os.homedir(),
      "OneDrive - POLITICO",
      "Salesforce Pulls",
      "Duplicate Reviewer",
      "prod",
      "Output",
      "prod-contacts",
      "salesforce-report-latest.csv"
    );
  }

  return path.join(
    os.homedir(),
    "Library",
    "CloudStorage",
    "OneDrive-POLITICO",
    "Automation Projects",
    "Salesforce Pulls",
    "Duplicate Reviewer",
    "prod",
    "Output",
    "prod-contacts",
    "salesforce-report-latest.csv"
  );
}

function defaultProdAccountsCsvPath() {
  if (process.platform === "win32") {
    return path.join(
      os.homedir(),
      "OneDrive - POLITICO",
      "Salesforce Pulls",
      "Duplicate Reviewer",
      "prod",
      "Output",
      "prod-accounts",
      "salesforce-report-latest.csv"
    );
  }

  return path.join(
    os.homedir(),
    "Library",
    "CloudStorage",
    "OneDrive-POLITICO",
    "Automation Projects",
    "Salesforce Pulls",
    "Duplicate Reviewer",
    "prod",
    "Output",
    "prod-accounts",
    "salesforce-report-latest.csv"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function loadDotEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return;

  const text = fsSync.readFileSync(filePath, "utf8");
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

async function main() {
  await primeHealthState();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendError(response, error);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Salesforce Duplicate Reviewer running at http://${HOST}:${PORT}`);
  });

  setInterval(() => {
    primeHealthState().catch((error) => {
      console.warn("Salesforce Duplicate Reviewer health state could not be refreshed", error);
    });
  }, HEALTH_REFRESH_INTERVAL_MS).unref();
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, {
      ok: true,
      appId: "salesforce-duplicate-reviewer",
      stickyNotifications: true,
      stagingAccounts: true,
      prodAccounts: true,
      latestStagingFiles: true,
      latestProdFiles: true,
      jsonDatasets: true,
      staticAssetRoot: Boolean(process.env.DUPLICATE_REVIEWER_STATIC_DIR),
      svgStaticAssets: true,
      brandLogoAsset: true,
      brandHeaderVersion: "shared-logo-contact-v1",
      featureVersion: FEATURE_VERSION,
      apiContractVersion: API_CONTRACT_VERSION,
      salesforceAuthFresh: healthState.salesforceAuthFresh,
      salesforceAuthFreshCheckedAt: healthState.salesforceAuthFreshCheckedAt,
      runtimeAligned: healthState.runtimeAligned,
      runtimeAlignedCheckedAt: healthState.runtimeAlignedCheckedAt,
      sharedBrandLogo: true,
      headerContact: true,
      salesforceMerge: true,
      salesforcePreMergeCheck: true,
      salesforceCliWarningSafe: true,
      salesforceCliApiVersionEnvIsolated: true,
      salesforceMergeObjectTypes: ["Contact"],
      pid: process.pid,
      port: PORT
    }, 200, fileModeCorsHeaders(request));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/salesforce/orgs") {
    const result = await salesforceMergeService.listOrgs();
    sendJson(response, result);
    return;
  }

  if (request.method === "GET" && CSV_ENDPOINTS.has(url.pathname)) {
    const endpoint = CSV_ENDPOINTS.get(url.pathname);
    const cached = await cachedEndpointResponse(endpoint, "csv", () => readCsvEndpointData(endpoint));
    if (sendNotModifiedIfFresh(request, response, cached)) return;
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="${endpoint.fileName}"`,
      ...cacheValidationHeaders(cached)
    });
    response.end(cached.body);
    return;
  }

  if (request.method === "GET" && JSON_ENDPOINTS.has(url.pathname)) {
    const endpoint = JSON_ENDPOINTS.get(url.pathname);
    const cached = await cachedEndpointResponse(endpoint, "json", async () => {
      const data = await readJsonEndpointData(endpoint);
      return Buffer.from(`${JSON.stringify(data)}\n`, "utf8");
    });
    if (sendNotModifiedIfFresh(request, response, cached)) return;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `inline; filename="${endpoint.fileName}"`,
      ...cacheValidationHeaders(cached)
    });
    response.end(cached.body);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/staging/latest-files") {
    const files = await latestFilesForSource("staging");
    sendJson(response, { files });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/prod/latest-files") {
    const files = await latestFilesForSource("prod");
    sendJson(response, { files });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/notify") {
    const body = await readJsonBody(request);
    await notify(body.title || "Duplicate Reviewer", body.message || "Ready to review.", { sticky: Boolean(body.sticky) });
    sendJson(response, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/salesforce/merge") {
    const body = await readJsonBody(request, 128 * 1024);
    const result = await salesforceMergeService.mergeRecords(body);
    sendJson(response, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/salesforce/premerge-check") {
    const body = await readJsonBody(request, 256 * 1024);
    const result = await salesforceMergeService.checkPreMergeFreshness(body);
    sendJson(response, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/codex/training-labels") {
    const body = await readJsonBody(request, 25 * 1024 * 1024);
    const rows = validateTrainingLabelRows(body.rows);
    const separatedRows = validateSeparatedTrainingRows(body.separatedRows);
    const receivedAt = new Date();
    const timestamp = timestampForFileName(receivedAt);
    const csv = rowsToCsv(rows);
    const labelCount = Math.max(0, rows.length - 1);
    const separationCount = separatedRows.length;
    const csvFileName = `codex-training-labels-${timestamp}.csv`;
    const csvPath = path.join(OUTPUT_DIR, csvFileName);
    const latestCsvPath = path.join(OUTPUT_DIR, "codex-training-labels-latest.csv");
    const separatedFileName = `codex-training-separations-${timestamp}.json`;
    const separatedPath = path.join(OUTPUT_DIR, separatedFileName);
    const latestSeparatedPath = path.join(OUTPUT_DIR, "codex-training-separations-latest.json");
    const manifestPath = path.join(OUTPUT_DIR, "codex-training-labels-latest.json");
    const requestPath = path.join(OUTPUT_DIR, `codex-training-request-${timestamp}.md`);
    const latestRequestPath = path.join(OUTPUT_DIR, "codex-training-request-latest.md");
    const requestedAction = String(
      body.requestedAction ||
        "Read the latest training-label CSV and separated-record JSON, evaluate where the duplicate matching logic disagrees with the user's labels and manual separations, and improve the matching/scoring logic safely."
    );
    const manifest = {
      receivedAt: receivedAt.toISOString(),
      objectType: String(body.objectType || ""),
      fileName: String(body.fileName || ""),
      datasetKey: String(body.datasetKey || ""),
      sourceDataset: sanitizeCodexSourceDataset(body.sourceDataset),
      rowCount: Number(body.rowCount || 0),
      groupCount: Number(body.groupCount || 0),
      labelCount,
      separationCount,
      requestedAction,
      csvPath,
      latestCsvPath,
      separatedPath,
      latestSeparatedPath,
      requestPath,
      latestRequestPath
    };
    const requestMarkdown = buildCodexTrainingRequest(manifest);

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(csvPath, csv);
    await fs.writeFile(latestCsvPath, csv);
    await fs.writeFile(separatedPath, `${JSON.stringify(separatedRows, null, 2)}\n`);
    await fs.writeFile(latestSeparatedPath, `${JSON.stringify(separatedRows, null, 2)}\n`);
    await fs.writeFile(requestPath, requestMarkdown);
    await fs.writeFile(latestRequestPath, requestMarkdown);
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let codexSessionLaunched = false;
    let codexSessionError = "";
    if (body.openCodexSession) {
      try {
        await openCodexTrainingSession(latestRequestPath);
        codexSessionLaunched = true;
      } catch (error) {
        codexSessionError = error.message || "Codex session could not be opened.";
      }
    }

    sendJson(response, {
      ok: true,
      labelCount,
      separationCount,
      csvPath,
      latestCsvPath,
      separatedPath,
      latestSeparatedPath,
      manifestPath,
      requestPath,
      latestRequestPath,
      codexSessionLaunched,
      codexSessionError
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    throw httpError(405, "Method not allowed");
  }

  await serveStatic(response, url.pathname, request.method === "HEAD");
}

async function serveStatic(response, requestPath, headOnly) {
  const resolved = resolveStaticPath(STATIC_ROOT_DIR, requestPath === "/" ? "/index.html" : requestPath);

  try {
    const data = await readFileWithRetry(resolved);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(resolved),
      "Cache-Control": "no-store"
    });
    if (headOnly) response.end();
    else response.end(data);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "Not found");
    throw error;
  }
}

function resolveStaticPath(rootDir, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    throw httpError(400, "Request path is not valid URL encoding.");
  }

  const resolved = path.resolve(rootDir, `.${decodedPath}`);
  if (!isPathInside(rootDir, resolved)) throw httpError(403, "Forbidden");
  return resolved;
}

function isPathInside(rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readFileWithRetry(filePath, attempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      lastError = error;
      if (!isTransientFileProviderReadError(error)) break;
      try {
        return await readFileByStream(filePath);
      } catch (streamError) {
        lastError = streamError;
      }
      if (attempt === attempts) break;
      await delay(75 * attempt);
    }
  }
  throw lastError;
}

function readFileByStream(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function isTransientFileProviderReadError(error) {
  return error?.errno === -11 || error?.errno === -60 || error?.code === "ETIMEDOUT" || error?.code === "EDEADLK";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCsvEndpointData(endpoint) {
  try {
    return await readFileWithRetry(endpoint.path);
  } catch (error) {
    if (!endpoint.jsonPath || !isTransientFileProviderReadError(error)) throw error;
    const json = await readFileWithRetry(endpoint.jsonPath, 2);
    return Buffer.from(salesforceJsonExportToCsv(json), "utf8");
  }
}

async function readJsonEndpointData(endpoint) {
  try {
    const json = await readFileWithRetry(endpoint.path);
    return reviewDatasetFromJsonExport(json, endpoint);
  } catch (error) {
    if (!endpoint.csvPath || (error.code !== "ENOENT" && !isTransientFileProviderReadError(error))) throw error;
    const csv = await readFileWithRetry(endpoint.csvPath, 2);
    return reviewDatasetFromCsv(csv, endpoint);
  }
}

async function latestFilesForSource(sourcePrefix) {
  const files = await Promise.all(
    [...JSON_ENDPOINTS.entries()].filter(([, endpoint]) => String(endpoint.source || "").startsWith(`${sourcePrefix}-`)).map(async ([endpointPath, endpoint]) => {
      const stat = await latestEndpointStat(endpoint);
      if (!stat) return null;

      return {
        source: String(endpoint.source || ""),
        objectType: endpoint.objectType,
        label: endpoint.label,
        name: endpoint.fileName,
        endpoint: endpointPath,
        size: stat.size,
        updatedAt: Math.floor(stat.mtimeMs)
      };
    })
  );

  return files.filter(Boolean);
}

async function latestEndpointStat(endpoint) {
  try {
    return await fs.stat(endpoint.path);
  } catch (error) {
    if (error.code !== "ENOENT" && !isTransientFileProviderReadError(error)) throw error;
  }

  const fallbackPath = endpoint.jsonPath || endpoint.csvPath;
  if (!fallbackPath) return null;
  try {
    return await fs.stat(fallbackPath);
  } catch (error) {
    if (error.code === "ENOENT" || isTransientFileProviderReadError(error)) return null;
    throw error;
  }
}

async function cachedEndpointResponse(endpoint, format, buildBody) {
  const version = await latestEndpointVersion(endpoint);
  const cacheKey = [
    format,
    version.path,
    version.size,
    Math.floor(version.mtimeMs)
  ].join("|");
  const cached = endpointResponseCache.get(cacheKey);
  if (cached) return cached;

  const body = await buildBody();
  const response = {
    body: Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8"),
    etag: weakEtag(version),
    lastModified: new Date(version.mtimeMs).toUTCString()
  };
  endpointResponseCache.set(cacheKey, response);
  pruneEndpointResponseCache();
  return response;
}

async function latestEndpointVersion(endpoint) {
  const paths = [endpoint.path, endpoint.jsonPath, endpoint.csvPath].filter(Boolean);
  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath);
      return {
        path: filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
    } catch (error) {
      if (error.code !== "ENOENT" && !isTransientFileProviderReadError(error)) throw error;
    }
  }
  throw httpError(404, "Latest Salesforce export was not found.");
}

function weakEtag(version) {
  return `W/"${Buffer.from(`${version.path}:${version.size}:${Math.floor(version.mtimeMs)}`).toString("base64url")}"`;
}

function sendNotModifiedIfFresh(request, response, cached) {
  if (request.headers["if-none-match"] !== cached.etag) return false;
  response.writeHead(304, cacheValidationHeaders(cached));
  response.end();
  return true;
}

function cacheValidationHeaders(cached) {
  return {
    "Cache-Control": "private, max-age=0, must-revalidate",
    ETag: cached.etag,
    "Last-Modified": cached.lastModified
  };
}

function pruneEndpointResponseCache() {
  while (endpointResponseCache.size > ENDPOINT_RESPONSE_CACHE_LIMIT) {
    const [oldestKey] = endpointResponseCache.keys();
    endpointResponseCache.delete(oldestKey);
  }
}

function salesforceJsonExportToCsv(json) {
  const payload = JSON.parse(Buffer.isBuffer(json) ? json.toString("utf8") : String(json || ""));
  if (!Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
    throw httpError(500, "Salesforce JSON export is not in the expected column/row format.");
  }
  return rowsToCsv([payload.columns, ...payload.rows]);
}

function reviewDatasetFromJsonExport(json, endpoint) {
  const payload = JSON.parse(Buffer.isBuffer(json) ? json.toString("utf8") : String(json || ""));
  if (payload?.schema === "salesforce-duplicate-reviewer.dataset" && Array.isArray(payload.records)) {
    return {
      ...payload,
      schemaVersion: Number(payload.schemaVersion) || 1,
      objectType: endpoint.objectType,
      fileName: endpoint.fileName,
      source: {
        ...(payload.source || {}),
        name: endpoint.label,
        orgAlias: payload.source?.orgAlias || endpoint.orgAlias || STAGING_SF_ORG_ALIAS,
        instanceUrl: payload.source?.instanceUrl || normalizeInstanceUrl(endpoint.instanceUrl || STAGING_SF_INSTANCE_URL)
      }
    };
  }

  if (Array.isArray(payload.columns) && Array.isArray(payload.rows)) {
    const columns = payload.columns.map((column) => String(column || ""));
    return reviewDatasetEnvelope({
      endpoint,
      fields: columns.map((column) => ({ apiName: column, label: column, type: "text" })),
      records: payload.rows.map((row) => rowArrayToObject(columns, row)),
      format: "salesforce-json-export"
    });
  }

  const records = Array.isArray(payload.records)
    ? payload.records
    : Array.isArray(payload.result?.records)
      ? payload.result.records
      : null;
  if (records) {
    const normalizedRecords = records.map(normalizeJsonRecord);
    const columns = inferRecordHeaders(normalizedRecords);
    return reviewDatasetEnvelope({
      endpoint,
      fields: columns.map((column) => ({ apiName: column, label: column, type: "text" })),
      records: normalizedRecords,
      format: "salesforce-records-json"
    });
  }

  throw httpError(500, "Salesforce JSON export is not in the expected dataset format.");
}

function reviewDatasetFromCsv(csv, endpoint) {
  const parsed = parseCsv(Buffer.isBuffer(csv) ? csv.toString("utf8") : String(csv || ""));
  return reviewDatasetEnvelope({
    endpoint,
    fields: parsed.headers.map((header) => ({ apiName: header, label: header, type: "text" })),
    records: parsed.rows,
    format: "csv-fallback"
  });
}

function reviewDatasetEnvelope({ endpoint, fields, records, format }) {
  return {
    schema: "salesforce-duplicate-reviewer.dataset",
    schemaVersion: 1,
    objectType: endpoint.objectType,
    fileName: endpoint.fileName,
    source: {
      system: "salesforce",
      name: endpoint.label,
      format,
      orgAlias: endpoint.orgAlias || STAGING_SF_ORG_ALIAS,
      instanceUrl: normalizeInstanceUrl(endpoint.instanceUrl || STAGING_SF_INSTANCE_URL)
    },
    fields,
    records
  };
}

function rowArrayToObject(headers, row) {
  const values = Array.isArray(row) ? row : [];
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function normalizeJsonRecord(record) {
  if (!record || typeof record !== "object") return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "attributes")
      .map(([key, value]) => [key, normalizeJsonCell(value)])
  );
}

function normalizeJsonCell(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function inferRecordHeaders(records) {
  const headers = new Set();
  records.forEach((record) => {
    Object.keys(record).forEach((key) => headers.add(key));
  });
  return [...headers];
}

function parseCsv(csvText) {
  const rows = [];
  let record = [];
  let cell = "";
  let headers = null;
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"' && insideQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      record.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      headers = pushCsvRecord(rows, headers, record, cell);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || record.length) {
    headers = pushCsvRecord(rows, headers, record, cell);
  }

  return { headers: headers || [], rows };
}

function pushCsvRecord(rows, headers, record, cell) {
  record.push(cell);
  if (!record.some((value) => value.trim().length > 0)) return headers;

  if (!headers) {
    return record.map((header) => header.replace(/^\uFEFF/, "").trim());
  }

  rows.push(rowArrayToObject(headers, record));
  return headers;
}

async function readJsonBody(request, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, "Request body is too large");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be JSON");
  }
}

function createSalesforceMergeService() {
  return {
    checkPreMergeFreshness: checkSalesforcePreMergeFreshness,
    mergeRecords: mergeSalesforceRecords,
    listOrgs: listSalesforceOrgs
  };
}

async function listSalesforceOrgs() {
  const cacheKey = "default";
  const cached = salesforceOrgListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const configuredOrgs = [
    {
      alias: SF_ORG_ALIAS,
      instanceUrl: normalizeInstanceUrl(SF_INSTANCE_URL)
    }
  ];

  try {
    const payload = await execFileJson(salesforceCliCommand(), ["org", "list", "--json"], {
      env: salesforceCliEnv()
    });
    const orgs = mergeSalesforceOrgRecords(salesforceOrgsFromListPayload(payload), configuredOrgs);
    const value = { orgs };
    salesforceOrgListCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + SALESFORCE_ORG_LIST_CACHE_TTL_MS
    });
    return value;
  } catch (error) {
    const warning = error.message || "Salesforce org catalog could not be loaded.";
    const value = {
      orgs: mergeSalesforceOrgRecords(configuredOrgs),
      warning
    };
    salesforceOrgListCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + SALESFORCE_ORG_LIST_CACHE_TTL_MS
    });
    return value;
  }
}

async function checkSalesforcePreMergeFreshness(body) {
  const mergeRequest = validateMergeRequest(body, { requireConfirmation: false });
  return withSalesforceAuthRefresh((auth) => buildPreMergeFreshnessResult({
    auth,
    objectType: mergeRequest.objectType,
    groupKey: mergeRequest.groupKey,
    masterId: mergeRequest.masterId,
    mergeIds: mergeRequest.mergeIds,
    loadedRecords: mergeRequest.loadedRecords
  }), mergeRequest);
}

async function checkSalesforceAuthFreshness(options = {}) {
  try {
    const auth = await getSalesforceAuth({ ...options, forceRefresh: true });
    return {
      ok: Boolean(auth?.accessToken && auth?.instanceUrl && auth?.orgAlias),
      checkedAt: new Date().toISOString(),
      orgAlias: auth.orgAlias,
      instanceUrl: auth.instanceUrl,
      apiVersion: auth.apiVersion
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: error.message || "Salesforce authentication is stale."
    };
  }
}

async function primeHealthState() {
  const [authFresh, runtimeAligned] = await Promise.all([
    checkSalesforceAuthFreshness(),
    isRuntimeAligned()
  ]);
  healthState = {
    salesforceAuthFresh: authFresh.ok,
    salesforceAuthFreshCheckedAt: authFresh.checkedAt,
    runtimeAligned,
    runtimeAlignedCheckedAt: new Date().toISOString()
  };
}

async function mergeSalesforceRecords(body) {
  const mergeRequest = validateMergeRequest(body, { requireConfirmation: true });
  const auditBase = {
    requestedAt: new Date().toISOString(),
    objectType: mergeRequest.objectType,
    groupKey: mergeRequest.groupKey,
    masterId: mergeRequest.masterId,
    mergeIds: mergeRequest.mergeIds,
    masterFields: mergeRequest.masterFields,
    masterFieldsToNull: mergeRequest.masterFieldsToNull,
    loadedRecords: mergeRequest.loadedRecords,
    orgAlias: mergeRequest.orgAlias,
    instanceUrl: mergeRequest.instanceUrl
  };

  try {
    let auth = await getSalesforceAuth(mergeRequest);
    let preMergeCheck;
    try {
      preMergeCheck = await buildPreMergeFreshnessResult({
        auth,
        objectType: mergeRequest.objectType,
        groupKey: mergeRequest.groupKey,
        masterId: mergeRequest.masterId,
        mergeIds: mergeRequest.mergeIds,
        loadedRecords: mergeRequest.loadedRecords
      });
    } catch (error) {
      if (!isSalesforceAuthRejected(error)) throw error;
      clearSalesforceAuthCache(mergeRequest);
      auth = await getSalesforceAuth({ ...mergeRequest, forceRefresh: true });
      preMergeCheck = await buildPreMergeFreshnessResult({
        auth,
        objectType: mergeRequest.objectType,
        groupKey: mergeRequest.groupKey,
        masterId: mergeRequest.masterId,
        mergeIds: mergeRequest.mergeIds,
        loadedRecords: mergeRequest.loadedRecords
      });
    }
    if (preMergeCheck.status !== "fresh") {
      throw httpError(409, preMergeFreshnessSummary(preMergeCheck), { preMergeCheck });
    }

    const batches = chunkArray(mergeRequest.mergeIds, 2);
    const results = [];

    for (const batch of batches) {
      results.push(
        await mergeSalesforceRecordBatch({
          auth,
          objectType: mergeRequest.objectType,
          masterId: mergeRequest.masterId,
          mergeIds: batch,
          masterFields: mergeRequest.masterFields,
          masterFieldsToNull: mergeRequest.masterFieldsToNull
        })
      );
    }

    const response = {
      ok: true,
      status: "success",
      objectType: mergeRequest.objectType,
      groupKey: mergeRequest.groupKey,
      masterId: mergeRequest.masterId,
      masterFields: mergeRequest.masterFields,
      masterFieldsToNull: mergeRequest.masterFieldsToNull,
      mergedRecordIds: [...new Set(results.flatMap((result) => result.mergedRecordIds))],
      updatedRelatedIds: [...new Set(results.flatMap((result) => result.updatedRelatedIds))],
      batches: results,
      instanceUrl: auth.instanceUrl,
      apiVersion: auth.apiVersion,
      orgAlias: auth.orgAlias,
      selectedOrgAlias: mergeRequest.orgAlias,
      selectedInstanceUrl: mergeRequest.instanceUrl,
      preMergeCheck,
      recoverySnapshot: buildMergeRecoverySnapshot(preMergeCheck),
      mergedAt: new Date().toISOString()
    };
    const mergeReport = buildMergeReport({
      mergeRequest,
      response,
      preMergeCheck
    });
    response.mergeReport = mergeReport;
    await writeMergeReportArtifacts(mergeReport);
    await appendMergeAudit({ ...auditBase, status: "success", response });
    return response;
  } catch (error) {
    await appendMergeAudit({
      ...auditBase,
      status: "failed",
      error: error.message || "Merge failed",
      preMergeCheck: error.preMergeCheck || error.details?.preMergeCheck || null
    }).catch(() => {});
    throw error;
  }
}

function validateMergeRequest(body, options = {}) {
  const objectType = normalizeMergeObjectType(body.objectType);
  const masterId = normalizeSalesforceId(body.masterId);
  const mergeIds = uniqueIds(Array.isArray(body.mergeIds) ? body.mergeIds : []).filter((id) => id !== masterId);
  const masterFields = validateMergeMasterFields(body.masterFields);
  const masterFieldsToNull = validateMergeMasterFieldsToNull(body.masterFieldsToNull, masterFields);
  const loadedRecords = validatePreMergeLoadedRecords(body.records);
  const selectedOrg = normalizeRequestedSalesforceOrg(body);
  const expectedPrefix = "003";

  if (!masterId) throw httpError(400, "A master Salesforce ID is required.");
  if (!masterId.startsWith(expectedPrefix)) throw httpError(400, `${objectType} merges require ${expectedPrefix} Salesforce IDs.`);
  if (!mergeIds.length) throw httpError(400, "At least one duplicate Salesforce ID is required.");
  if (mergeIds.length > MAX_MERGE_VICTIMS) {
    throw httpError(400, `A single merge action is limited to ${MAX_MERGE_VICTIMS} duplicate records.`);
  }
  mergeIds.forEach((id) => {
    if (!id.startsWith(expectedPrefix)) throw httpError(400, `${objectType} merges require ${expectedPrefix} Salesforce IDs.`);
  });

  return {
    objectType,
    masterId,
    mergeIds,
    masterFields,
    masterFieldsToNull,
    loadedRecords,
    groupKey: String(body.groupKey || ""),
    orgAlias: selectedOrg.orgAlias,
    instanceUrl: selectedOrg.instanceUrl
  };
}

function validatePreMergeLoadedRecords(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw httpError(400, "records must be an array.");
  if (value.length > MAX_MERGE_VICTIMS + 1) throw httpError(400, `A merge freshness check supports up to ${MAX_MERGE_VICTIMS + 1} records.`);

  return value.map((record) => {
    if (!record || typeof record !== "object") throw httpError(400, "Each freshness record must be an object.");
    const id = normalizeSalesforceId(record.id);
    if (!id) throw httpError(400, "Each freshness record requires a valid Salesforce ID.");
    const fields = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
      ? record.fields
      : {};
    const sourceRow = record.sourceRow && typeof record.sourceRow === "object" && !Array.isArray(record.sourceRow)
      ? Object.fromEntries(Object.entries(record.sourceRow).map(([key, value]) => [String(key || ""), String(value ?? "")]))
      : {};
    return {
      id,
      name: String(record.name || ""),
      rowIndex: Number.isFinite(Number(record.rowIndex)) ? Number(record.rowIndex) : null,
      sourceRow,
      fields: Object.fromEntries(
        CONTACT_PREMERGE_COMPARISON_FIELDS
          .filter(([field]) => Object.prototype.hasOwnProperty.call(fields, field))
          .map(([field]) => [field, String(fields[field] ?? "")])
      )
    };
  });
}

async function buildPreMergeFreshnessResult({ auth, objectType, groupKey, masterId, mergeIds, loadedRecords = [] }) {
  if (objectType !== "Contact") throw httpError(400, "Only Contact merge freshness checks are supported.");
  const ids = uniqueIds([masterId, ...mergeIds]);
  const loadedById = new Map(loadedRecords.map((record) => [salesforceIdKey(record.id), record]));
  const currentRecords = await querySalesforceContactsByIds(auth, ids);
  const currentById = new Map(currentRecords.map((record) => [salesforceIdKey(record.Id), record]));
  const missingIds = [];
  const deletedIds = [];
  const changedFields = [];

  ids.forEach((id) => {
    const current = currentById.get(salesforceIdKey(id));
    const loaded = loadedById.get(salesforceIdKey(id));
    if (!current) {
      missingIds.push(id);
      return;
    }
    if (current.IsDeleted) deletedIds.push(id);
    if (!loaded) return;

    CONTACT_PREMERGE_COMPARISON_FIELDS.forEach(([field, label]) => {
      if (!Object.prototype.hasOwnProperty.call(loaded.fields, field)) return;
      const loadedValue = loaded.fields[field];
      const currentValue = currentContactComparisonValue(current, field);
      if (sameSalesforceFreshnessValue(field, loadedValue, currentValue)) return;
      changedFields.push({
        id,
        recordName: loaded.name || current.Name || id,
        field,
        label,
        loadedValue,
        currentValue
      });
    });
  });

  const status = missingIds.length || deletedIds.length || changedFields.length ? "stale" : "fresh";
  const checkedAt = new Date().toISOString();
  return {
    ok: status === "fresh",
    status,
    checkedAt,
    objectType,
    groupKey,
    masterId,
    mergeIds,
    ids,
    orgAlias: auth.orgAlias,
    instanceUrl: auth.instanceUrl,
    apiVersion: auth.apiVersion,
    missingIds,
    deletedIds,
    changedFields,
    currentRecords: currentRecords.map(salesforceContactRecoveryRecord),
    loadedRecords
  };
}

async function querySalesforceContactsByIds(auth, ids) {
  if (!ids.length) return [];
  const idList = ids.map((id) => `'${soqlStringEscape(id)}'`).join(",");
  const soql = `SELECT ${CONTACT_PREMERGE_SOQL_FIELDS.join(", ")} FROM Contact WHERE Id IN (${idList})`;
  const url = `${auth.instanceUrl}/services/data/${auth.apiVersion}/queryAll?q=${encodeURIComponent(soql)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw httpError(401, "Salesforce authentication was rejected. Refreshing the Salesforce session may be required.");
    }
    throw httpError(502, `Salesforce freshness check failed: ${payload?.[0]?.message || payload.message || `${response.status} ${response.statusText}`}`);
  }
  return Array.isArray(payload.records) ? payload.records.map(stripSalesforceAttributes) : [];
}

function stripSalesforceAttributes(record) {
  if (!record || typeof record !== "object") return {};
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "attributes"));
}

function salesforceContactRecoveryRecord(record) {
  const normalized = {
    ...record,
    AccountName: record?.Account?.Name || ""
  };
  return Object.fromEntries(RECOVERY_SNAPSHOT_FIELDS.map((field) => [field, normalized[field] ?? ""]));
}

function currentContactComparisonValue(record, field) {
  if (field === "fullName") return record.Name || "";
  if (field === "firstName") return record.FirstName || "";
  if (field === "lastName") return record.LastName || "";
  if (field === "company") return record.Account?.Name || "";
  if (field === "email") return record.Email || "";
  if (field === "leadSource") return record.LeadSource || "";
  if (field === "phone") return record.Phone || "";
  if (field === "mobile") return record.MobilePhone || "";
  return "";
}

function sameSalesforceFreshnessValue(field, left, right) {
  return normalizeSalesforceFreshnessValue(field, left) === normalizeSalesforceFreshnessValue(field, right);
}

function normalizeSalesforceFreshnessValue(field, value) {
  const text = String(value ?? "").trim();
  if (field === "phone" || field === "mobile") {
    return text.replace(/\D/g, "");
  }
  return text.toLowerCase().replace(/\s+/g, " ");
}

function preMergeFreshnessSummary(check) {
  const parts = [];
  if (check.missingIds?.length) parts.push(`${check.missingIds.length} missing`);
  if (check.deletedIds?.length) parts.push(`${check.deletedIds.length} deleted`);
  if (check.changedFields?.length) parts.push(`${check.changedFields.length} changed field${check.changedFields.length === 1 ? "" : "s"}`);
  return `Pre-merge freshness check failed (${parts.join(", ") || "stale data"}). Refresh Contacts before merging.`;
}

function buildMergeRecoverySnapshot(check) {
  return {
    capturedAt: check.checkedAt,
    note: "Use this audit snapshot as recovery evidence. Salesforce does not provide a complete automatic rollback for merges; restore deleted duplicate Contacts from the Recycle Bin if available, then manually repair related-record ownership and any master-field changes.",
    masterId: check.masterId,
    duplicateIds: check.mergeIds,
    currentRecords: check.currentRecords
  };
}

function buildMergeReport({ mergeRequest, response, preMergeCheck }) {
  const mergedAt = response.mergedAt || new Date().toISOString();
  const timestamp = timestampForFileName(new Date(mergedAt));
  const fileName = `salesforce-merge-report-${timestamp}.csv`;
  const latestFileName = "salesforce-merge-report-latest.csv";
  const manifestFileName = `salesforce-merge-report-${timestamp}.json`;
  const latestManifestFileName = "salesforce-merge-report-latest.json";
  const loadedRecordsById = new Map(
    (mergeRequest?.loadedRecords || [])
      .filter((record) => record && record.id)
      .map((record) => [salesforceIdKey(record.id), record])
  );
  const currentRecordsById = new Map(
    (preMergeCheck?.currentRecords || [])
      .filter((record) => record && record.Id)
      .map((record) => [salesforceIdKey(record.Id), record])
  );
  const recordsById = new Map();
  const getRecordSnapshot = (id) => {
    const displayId = String(id || "").trim();
    const normalizedId = salesforceIdKey(displayId);
    if (!normalizedId) return null;
    if (!recordsById.has(normalizedId)) {
      recordsById.set(normalizedId, buildMergeReportRecordSnapshot({
        loadedRecord: loadedRecordsById.get(normalizedId) || null,
        currentRecord: currentRecordsById.get(normalizedId) || null,
        id: displayId
      }));
    }
    return recordsById.get(normalizedId);
  };
  const rowHeaders = ["ROLE", ...MERGE_REPORT_RECORD_HEADERS, "STATUS", "DETAILS"];
  const rows = [
    rowHeaders,
    mergeReportRow({
      role: "Master record",
      id: mergeRequest.masterId,
      record: getRecordSnapshot(mergeRequest.masterId),
      status: "Retained as master",
      details: "Kept as the Salesforce merge master"
    })
  ];

  (response.mergedRecordIds || mergeRequest.mergeIds || []).forEach((id) => {
    rows.push(mergeReportRow({
      role: "Duplicate record",
      id,
      record: getRecordSnapshot(id),
      status: "Merged into master",
      details: "Deleted by Salesforce merge; related records were reparented to the master"
    }));
  });

  (response.updatedRelatedIds || []).forEach((id) => {
    rows.push(mergeReportRow({
      role: "Related record",
      id,
      record: getRecordSnapshot(id),
      status: "Updated by merge",
      details: `Reparented to master ${response.masterId}`
    }));
  });

  return {
    generatedAt: mergedAt,
    fileName,
    latestFileName,
    csvPath: path.join(OUTPUT_DIR, fileName),
    latestCsvPath: MERGE_REPORT_LATEST_CSV,
    manifestPath: path.join(OUTPUT_DIR, manifestFileName),
    latestManifestPath: MERGE_REPORT_LATEST_JSON,
    rowCount: Math.max(0, rows.length - 1),
    rows
  };
}

function buildMergeReportRecordSnapshot({ loadedRecord = null, currentRecord = null, id = "" } = {}) {
  const loadedSnapshot = loadedRecord || {};
  const snapshot = currentRecord || {};
  const loadedFields = loadedSnapshot.fields || {};
  const sourceRow = loadedSnapshot.sourceRow || {};
  const sourceRowLookup = createSourceRowLookup(sourceRow);
  const sourceValue = (...candidates) => getSourceRowValue(sourceRowLookup, ...candidates);
  const salesforceId = String(
    sourceValue("Id", "Contact ID 18", "Contact Id 18", "Salesforce ID", "SF ID", "Record ID") ||
      loadedSnapshot.id ||
      loadedSnapshot.Id ||
      snapshot.Id ||
      id ||
      ""
  );
  if (loadedRecord) {
    const sourceFirstName = sourceValue("First Name", "FirstName", "Given Name") || loadedFields.firstName || "";
    const sourceLastName = sourceValue("Last Name", "LastName", "Surname", "Family Name") || loadedFields.lastName || "";
    const sourceFullName =
      sourceValue("Name", "Full Name", "Contact Name") ||
      [sourceFirstName, sourceLastName].filter(Boolean).join(" ");
    return {
      "Salesforce ID": salesforceId,
      Name: String(sourceFullName || loadedSnapshot.name || loadedFields.fullName || ""),
      "First Name": String(sourceFirstName),
      "Last Name": String(sourceLastName),
      Email: String(sourceValue("Email", "Email Address") || loadedFields.email || ""),
      "Lead Source": String(sourceValue("Lead Source", "LeadSource", "Source") || loadedFields.leadSource || ""),
      Phone: String(sourceValue("Phone", "Business Phone", "Work Phone") || loadedFields.phone || ""),
      "Mobile Phone": String(sourceValue("Mobile", "Mobile Phone", "Cell", "Cell Phone") || loadedFields.mobile || ""),
      "Account ID": String(sourceValue("Account ID", "AccountId") || ""),
      "Account Name": String(sourceValue("Account Name", "Account", "Company") || loadedFields.company || ""),
      "Created Date": String(sourceValue("Created Date", "CreatedDate", "Created") || ""),
      "Last Modified Date": String(sourceValue("Last Modified Date", "LastModifiedDate") || ""),
      "System Modstamp": String(sourceValue("System Modstamp", "SystemModstamp") || ""),
      "Is Deleted": String(sourceValue("Is Deleted", "IsDeleted") || "")
    };
  }

  return {
    "Salesforce ID": salesforceId,
    Name: String(snapshot.Name || ""),
    "First Name": String(snapshot.FirstName || ""),
    "Last Name": String(snapshot.LastName || ""),
    Email: String(snapshot.Email || ""),
    "Lead Source": String(snapshot.LeadSource || ""),
    Phone: String(snapshot.Phone || ""),
    "Mobile Phone": String(snapshot.MobilePhone || ""),
    "Account ID": String(snapshot.AccountId || ""),
    "Account Name": String(snapshot.AccountName || snapshot.Account?.Name || ""),
    "Created Date": String(snapshot.CreatedDate || ""),
    "Last Modified Date": String(snapshot.LastModifiedDate || ""),
    "System Modstamp": String(snapshot.SystemModstamp || ""),
    "Is Deleted": String(snapshot.IsDeleted ?? "")
  };
}

function createSourceRowLookup(sourceRow) {
  return new Map(
    Object.entries(sourceRow || {}).map(([key, value]) => [normalizeSourceHeaderKey(key), String(value ?? "")])
  );
}

function getSourceRowValue(sourceRowLookup, ...candidates) {
  for (const candidate of candidates) {
    const value = sourceRowLookup.get(normalizeSourceHeaderKey(candidate));
    if (value) return value;
  }
  return "";
}

function normalizeSourceHeaderKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function mergeReportRow({ role, id, record, status, details }) {
  const snapshot = record || buildMergeReportRecordSnapshot({ id });
  return [
    role,
    snapshot["Salesforce ID"] || String(id || ""),
    snapshot.Name || "",
    snapshot["First Name"] || "",
    snapshot["Last Name"] || "",
    snapshot.Email || "",
    snapshot["Lead Source"] || "",
    snapshot.Phone || "",
    snapshot["Mobile Phone"] || "",
    snapshot["Account ID"] || "",
    snapshot["Account Name"] || "",
    snapshot["Created Date"] || "",
    snapshot["Last Modified Date"] || "",
    snapshot["System Modstamp"] || "",
    snapshot["Is Deleted"] || "",
    status,
    details
  ];
}

async function writeMergeReportArtifacts(report) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(report.csvPath, rowsToCsv(report.rows));
  await fs.writeFile(report.latestCsvPath, rowsToCsv(report.rows));
  const manifest = {
    generatedAt: report.generatedAt,
    fileName: report.fileName,
    latestFileName: report.latestFileName,
    csvPath: report.csvPath,
    latestCsvPath: report.latestCsvPath,
    rowCount: report.rowCount
  };
  await fs.writeFile(report.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(report.latestManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function salesforceIdKey(id) {
  return String(id || "").slice(0, 15).toLowerCase();
}

function soqlStringEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function validateMergeMasterFields(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw httpError(400, "masterFields must be an object.");

  return Object.entries(value).reduce((fields, [field, rawValue]) => {
    const apiName = normalizeMergeMasterFieldName(field);
    const text = String(rawValue ?? "").trim();
    if (text) fields[apiName] = text;
    return fields;
  }, {});
}

function validateMergeMasterFieldsToNull(value, masterFields = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw httpError(400, "masterFieldsToNull must be an array.");

  const fields = [];
  const seen = new Set();
  value.forEach((field) => {
    const apiName = normalizeMergeMasterFieldName(field);
    if (seen.has(apiName) || Object.prototype.hasOwnProperty.call(masterFields, apiName)) return;
    seen.add(apiName);
    fields.push(apiName);
  });
  return fields;
}

function normalizeMergeMasterFieldName(value) {
  const apiName = String(value || "").trim();
  if (!MERGE_MASTER_FIELD_PATTERN.test(apiName) || !MERGE_MASTER_FIELD_ALLOWLIST.has(apiName)) {
    throw httpError(400, `Unsupported merge master field: ${apiName || "(blank)"}.`);
  }
  return apiName;
}

function normalizeMergeObjectType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "contact") return "Contact";
  throw httpError(400, "Only Contact merges are supported. Account merge is disabled in this app.");
}

function normalizeSalesforceId(value) {
  const id = String(value || "").trim();
  if (!id || !SALESFORCE_ID_PATTERN.test(id)) return "";
  return id;
}

function normalizeRequestedSalesforceOrg(value = {}) {
  return {
    orgAlias: canonicalSalesforceOrgAlias(value.orgAlias || SF_ORG_ALIAS || "", value.instanceUrl || SF_INSTANCE_URL),
    instanceUrl: normalizeInstanceUrl(value.instanceUrl || SF_INSTANCE_URL)
  };
}

function salesforceAuthCacheKey(value = {}) {
  const org = normalizeRequestedSalesforceOrg(value);
  return `${org.orgAlias.toLowerCase()}|${org.instanceUrl}|${normalizeApiVersion(SF_API_VERSION)}`;
}

function uniqueIds(values) {
  const ids = [];
  const seen = new Set();
  values.forEach((value) => {
    const id = normalizeSalesforceId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

async function withSalesforceAuthRefresh(operation, orgOptions = {}) {
  try {
    return await operation(await getSalesforceAuth(orgOptions));
  } catch (error) {
    if (!isSalesforceAuthRejected(error)) throw error;
    clearSalesforceAuthCache(orgOptions);
    return operation(await getSalesforceAuth({ ...orgOptions, forceRefresh: true }));
  }
}

async function getSalesforceAuth(options = {}) {
  const requestedOrg = normalizeRequestedSalesforceOrg(options);
  const envAccessToken = process.env.SF_ACCESS_TOKEN;
  const cacheKey = salesforceAuthCacheKey(requestedOrg);
  if (envAccessToken) {
    return {
      accessToken: envAccessToken,
      instanceUrl: requestedOrg.instanceUrl,
      apiVersion: normalizeApiVersion(SF_API_VERSION),
      orgAlias: requestedOrg.orgAlias
    };
  }

  if (!options.forceRefresh && salesforceAuthCache.has(cacheKey)) {
    const cached = salesforceAuthCache.get(cacheKey);
    if (cached.expiresAt > Date.now()) {
      return cached.value;
    }
    salesforceAuthCache.delete(cacheKey);
  }

  const display = await execFileJson(salesforceCliCommand(), ["org", "display", "--target-org", requestedOrg.orgAlias, "--json"], {
    env: salesforceCliEnv()
  });
  const result = display.result || {};
  const accessToken = await getSalesforceCliAccessToken(requestedOrg.orgAlias);

  const auth = {
    accessToken,
    instanceUrl: requestedOrg.instanceUrl || normalizeInstanceUrl(SF_INSTANCE_URL || result.instanceUrl),
    apiVersion: normalizeApiVersion(SF_API_VERSION),
    orgAlias: requestedOrg.orgAlias
  };
  salesforceAuthCache.set(cacheKey, {
    value: auth,
    expiresAt: Date.now() + SALESFORCE_AUTH_CACHE_TTL_MS
  });
  return auth;
}

function clearSalesforceAuthCache(options = {}) {
  const cacheKey = salesforceAuthCacheKey(normalizeRequestedSalesforceOrg(options));
  salesforceAuthCache.delete(cacheKey);
}

async function getSalesforceCliAccessToken(orgAlias) {
  const targetOrg = String(orgAlias || SF_ORG_ALIAS).trim() || SF_ORG_ALIAS;
  const tokenResult = await execFileJson(salesforceCliCommand(), ["org", "auth", "show-access-token", "--target-org", targetOrg, "--json"], {
    env: salesforceCliEnv()
  });
  const accessToken = String(tokenResult?.result?.accessToken || tokenResult?.result?.token || "").trim();
  if (!accessToken) throw httpError(500, `Salesforce CLI did not return an access token for ${targetOrg}.`);
  if (/^\[redacted\]/i.test(accessToken)) {
    throw httpError(500, `Salesforce CLI returned a redacted access token for ${targetOrg}.`);
  }
  return accessToken;
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

function mergeSalesforceOrgRecords(...lists) {
  const byAlias = new Map();
  for (const list of lists) {
    for (const candidate of list || []) {
      const org = salesforceOrgRecord(candidate);
      if (!org.alias) continue;
      const existing = byAlias.get(org.alias);
      byAlias.set(org.alias, existing ? mergeSalesforceOrgRecord(existing, org) : org);
    }
  }

  return [...byAlias.values()]
    .filter((org) => org.alias && org.instanceUrl)
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

function mergeSalesforceOrgRecord(existing, next) {
  return {
    alias: existing.alias || next.alias,
    username: existing.username || next.username,
    orgId: existing.orgId || next.orgId,
    instanceUrl: existing.instanceUrl || next.instanceUrl,
    loginUrl: existing.loginUrl || next.loginUrl,
    connectedStatus: existing.connectedStatus || next.connectedStatus
  };
}

function salesforceOrgRecord(org, fallbackAlias = "") {
  return {
    alias: canonicalSalesforceOrgAlias(org.alias || fallbackAlias || org.username || "", org.instanceUrl || ""),
    username: String(org.username || "").trim(),
    orgId: String(org.id || org.orgId || "").trim(),
    instanceUrl: String(org.instanceUrl || "").trim(),
    loginUrl: String(org.loginUrl || "").trim(),
    connectedStatus: String(org.connectedStatus || org.status || "").trim()
  };
}

function isSalesforceAuthRejected(error) {
  return Number(error?.status) === 401 || /401|unauthorized|invalid session|invalid_auth_header|invalid auth header/i.test(String(error?.message || ""));
}

function execFileJson(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const invocation = managedPlatform.commandInvocation(command, args, { envPrefix: "DUPLICATE_REVIEWER_SF" });
    childProcess.execFile(invocation.command, invocation.args, {
      maxBuffer: 10 * 1024 * 1024,
      ...options,
      env: {
        ...(options.env || process.env),
        ...(invocation.env || {})
      }
    }, (error, stdout, stderr) => {
      const parsed = parseSalesforceCliJson(stdout);
      if (parsed && isSalesforceCliJsonSuccess(parsed)) {
        resolve(parsed);
        return;
      }

      if (parsed && isSalesforceCliJsonFailure(parsed)) {
        reject(salesforceCliError("Salesforce CLI command failed", error, stdout, stderr, parsed));
        return;
      }

      if (error) {
        reject(salesforceCliError("Salesforce CLI command failed", error, stdout, stderr, parsed));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(httpError(500, "Salesforce CLI returned invalid JSON."));
      }
    });
  });
}

function salesforceCliEnv() {
  const env = { ...process.env };
  delete env.SF_API_VERSION;
  delete env.SF_ORG_API_VERSION;
  delete env.SFDX_API_VERSION;

  env.SF_AUTOUPDATE_DISABLE = process.env.SF_AUTOUPDATE_DISABLE || "true";
  env.SF_DISABLE_TELEMETRY = process.env.SF_DISABLE_TELEMETRY || "true";
  env.SF_HIDE_RELEASE_NOTES = process.env.SF_HIDE_RELEASE_NOTES || "true";
  env.SF_LOG_LEVEL = process.env.SF_LOG_LEVEL || "error";
  if (DEFAULT_PATH) {
    env.PATH = DEFAULT_PATH;
    if (process.platform === "win32") env.Path = DEFAULT_PATH;
  }
  if (process.platform !== "win32") {
    env.SF_USE_GENERIC_UNIX_KEYCHAIN = process.env.SF_USE_GENERIC_UNIX_KEYCHAIN || "true";
  }
  return env;
}

function parseSalesforceCliJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function isSalesforceCliJsonSuccess(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.status === 0 || payload.status === "0") return true;
  return !Object.prototype.hasOwnProperty.call(payload, "status") && Boolean(payload.result);
}

function isSalesforceCliJsonFailure(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "status");
}

function salesforceCliCommand() {
  if (salesforceCliCommandCache) return salesforceCliCommandCache;

  const candidates = SF_CLI_BIN ? [SF_CLI_BIN] : managedPlatform.salesforceCliCandidates();
  for (const candidate of candidates) {
    const resolved = managedPlatform.resolveExecutable(candidate, { defaultPath: DEFAULT_PATH });
    if (resolved) {
      salesforceCliCommandCache = resolved;
      return salesforceCliCommandCache;
    }
  }

  salesforceCliCommandCache = SF_CLI_BIN || managedPlatform.defaultSalesforceCliName();
  return salesforceCliCommandCache;
}

function salesforceCliError(message, error, stdout = "", stderr = "", parsed = null) {
  if (error?.code === "ENOENT") {
    return httpError(500, "Salesforce CLI was not found. Install Salesforce CLI or set SF_CLI_BIN in .env to the full path to sf, then restart Duplicate Reviewer.");
  }

  const parsedMessage = salesforceCliJsonErrorMessage(parsed);
  const stderrDetail = nonWarningSalesforceCliOutput(stderr);
  const stdoutDetail = parsedMessage ? "" : nonWarningSalesforceCliOutput(stdout);
  const processDetail = salesforceCliProcessErrorDetail(error, { parsedMessage, stderrDetail, stdoutDetail });
  const detail = [parsedMessage, stderrDetail, stdoutDetail, processDetail]
    .map((value) => String(value || "").trim())
    .filter(Boolean)[0] || "";
  return httpError(500, detail ? `${message}: ${detail}` : message);
}

function salesforceCliProcessErrorDetail(error, output = {}) {
  if (!error) return "";
  if (!output.parsedMessage && !output.stderrDetail && !output.stdoutDetail && error.code != null) {
    return `Salesforce CLI exited with code ${error.code} without JSON output.`;
  }

  return String(error.message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Command failed:/i.test(line) && !isSalesforceCliWarningLine(line))
    .join("\n")
    .trim();
}

function salesforceCliJsonErrorMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  const messages = [
    payload.message,
    payload.name,
    payload.errorCode,
    payload.error,
    payload.result?.message
  ].filter(Boolean);
  return messages.join(": ");
}

function nonWarningSalesforceCliOutput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isSalesforceCliWarningLine(line))
    .join("\n")
    .trim();
}

function isSalesforceCliWarningLine(line) {
  return (
    /^›?\s*Warning:/i.test(line) ||
    /^\(node:\d+\)\s+Warning:/i.test(line) ||
    /@salesforce\/cli update available/i.test(line) ||
    /org-api-version configuration overridden/i.test(line) ||
    /Use `node --trace-warnings/i.test(line)
  );
}

function normalizeInstanceUrl(value) {
  const url = new URL(value || SF_INSTANCE_URL);
  if (url.hostname.endsWith(".lightning.force.com")) {
    url.hostname = url.hostname.replace(".lightning.force.com", ".my.salesforce.com");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function canonicalSalesforceOrgAlias(value, instanceUrl = "") {
  const alias = String(value || "").trim();
  if (!alias) return "";
  if (alias.toLowerCase() !== "staging") return alias;
  return isCanonicalStagingSandboxInstanceUrl(instanceUrl) ? "politico-staging" : alias;
}

async function isRuntimeAligned() {
  if (!process.env.DUPLICATE_REVIEWER_STATIC_DIR) return true;

  try {
    for (const relativePath of RUNTIME_ALIGNMENT_FILES) {
      const sourcePath = path.join(ROOT_DIR, "public", relativePath);
      const runtimePath = path.join(STATIC_ROOT_DIR, relativePath);
      const [source, runtime] = await Promise.all([
        fs.readFile(sourcePath),
        fs.readFile(runtimePath)
      ]);
      if (!source.equals(runtime)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isCanonicalStagingSandboxInstanceUrl(value) {
  return normalizeInstanceUrl(value || SF_INSTANCE_URL) === normalizeInstanceUrl(SF_INSTANCE_URL);
}

function normalizeApiVersion(value) {
  const version = String(value || SF_API_VERSION).trim();
  return version.startsWith("v") ? version : `v${version}`;
}

async function mergeSalesforceRecordBatch({ auth, objectType, masterId, mergeIds, masterFields = {}, masterFieldsToNull = [] }) {
  const soapVersion = auth.apiVersion.replace(/^v/i, "");
  const response = await fetch(`${auth.instanceUrl}/services/Soap/u/${soapVersion}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "merge"
    },
    body: buildMergeSoapEnvelope({
      sessionId: auth.accessToken,
      objectType,
      masterId,
      mergeIds,
      masterFields,
      masterFieldsToNull
    })
  });
  const text = await response.text();
  const fault = soapFaultMessage(text);
  if (!response.ok || fault) {
    if (response.status === 401 || /invalid session|session expired|unauthorized/i.test(fault || "")) {
      throw httpError(401, "Salesforce authentication was rejected during merge. Log in to Salesforce again, then retry.");
    }
    throw httpError(502, `Salesforce merge failed: ${fault || `${response.status} ${response.statusText}`}`);
  }

  const result = parseMergeSoapResult(text);
  if (!result.success) {
    const message = result.errors.map((error) => error.message || error.statusCode).filter(Boolean).join("; ");
    throw httpError(502, `Salesforce merge failed: ${message || "unknown merge error"}`);
  }
  return result;
}

function buildMergeSoapEnvelope({ sessionId, objectType, masterId, mergeIds, masterFields = {}, masterFieldsToNull = [] }) {
  const fieldsToNullLines = masterFieldsToNull.map(
    (field) => `          <sobj:fieldsToNull>${xmlEscape(field)}</sobj:fieldsToNull>`
  );
  const masterFieldLines = Object.entries(masterFields).map(
    ([field, value]) => `          <sobj:${field}>${xmlEscape(value)}</sobj:${field}>`
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com" xmlns:sobj="urn:sobject.partner.soap.sforce.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    "  <soapenv:Header>",
    "    <urn:SessionHeader>",
    `      <urn:sessionId>${xmlEscape(sessionId)}</urn:sessionId>`,
    "    </urn:SessionHeader>",
    "  </soapenv:Header>",
    "  <soapenv:Body>",
    "    <urn:merge>",
    "      <urn:request>",
    `        <urn:masterRecord xsi:type="sobj:${xmlEscape(objectType)}">`,
    ...fieldsToNullLines,
    `          <sobj:Id>${xmlEscape(masterId)}</sobj:Id>`,
    ...masterFieldLines,
    "        </urn:masterRecord>",
    ...mergeIds.map((id) => `        <urn:recordToMergeIds>${xmlEscape(id)}</urn:recordToMergeIds>`),
    "      </urn:request>",
    "    </urn:merge>",
    "  </soapenv:Body>",
    "</soapenv:Envelope>"
  ].join("\n");
}

function parseMergeSoapResult(xml) {
  const resultXml = extractTagBlocks(xml, "result")[0] || "";
  const errors = extractTagBlocks(resultXml, "errors").map((errorXml) => ({
    statusCode: firstTagValue(errorXml, "statusCode"),
    message: firstTagValue(errorXml, "message"),
    fields: extractTagValues(errorXml, "fields")
  }));

  return {
    success: firstTagValue(resultXml, "success") === "true",
    id: firstTagValue(resultXml, "id"),
    mergedRecordIds: extractTagValues(resultXml, "mergedRecordIds"),
    updatedRelatedIds: extractTagValues(resultXml, "updatedRelatedIds"),
    errors
  };
}

function soapFaultMessage(xml) {
  return firstTagValue(xml, "faultstring") || firstTagValue(xml, "Text");
}

function firstTagValue(xml, tagName) {
  return extractTagValues(xml, tagName)[0] || "";
}

function extractTagValues(xml, tagName) {
  return extractTagBlocks(xml, tagName).map(decodeXml);
}

function extractTagBlocks(xml, tagName) {
  const values = [];
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tagName}>`, "g");
  let match;
  while ((match = pattern.exec(xml))) values.push(match[1]);
  return values;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function appendMergeAudit(record) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.appendFile(MERGE_AUDIT_LOG, `${JSON.stringify(record)}\n`);
}

function validateTrainingLabelRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1) {
    throw httpError(400, "Training label rows are required.");
  }
  if (!rows.every((row) => Array.isArray(row))) {
    throw httpError(400, "Training label rows must be arrays.");
  }
  return rows.map((row) => row.map((value) => String(value ?? "")));
}

function validateSeparatedTrainingRows(rows) {
  if (rows == null) return [];
  if (!Array.isArray(rows)) {
    throw httpError(400, "Separated training rows must be an array.");
  }
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw httpError(400, "Separated training rows must be objects.");
    }
    return {
      objectType: String(row.objectType || ""),
      fileName: String(row.fileName || ""),
      groupKey: String(row.groupKey || ""),
      groupScore: String(row.groupScore ?? ""),
      minPairScore: String(row.minPairScore ?? ""),
      separatedSalesforceId: String(row.separatedSalesforceId || ""),
      separatedRecordKey: String(row.separatedRecordKey || ""),
      separatedName: String(row.separatedName || ""),
      activeGroupSalesforceIds: Array.isArray(row.activeGroupSalesforceIds)
        ? row.activeGroupSalesforceIds.map((value) => String(value || ""))
        : [],
      activeGroupRecordKeys: Array.isArray(row.activeGroupRecordKeys)
        ? row.activeGroupRecordKeys.map((value) => String(value || ""))
        : [],
      activeGroupNames: Array.isArray(row.activeGroupNames)
        ? row.activeGroupNames.map((value) => String(value || ""))
        : []
    };
  });
}

function rowsToCsv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function timestampForFileName(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function buildCodexTrainingRequest(manifest) {
  const sourceDataset = sanitizeCodexSourceDataset(manifest.sourceDataset);
  return [
    "# Codex Training Label Review Request",
    "",
    `Created: ${manifest.receivedAt}`,
    `Object type: ${manifest.objectType || "unknown"}`,
    `Source file: ${manifest.fileName || "unknown"}`,
    `Dataset key: ${manifest.datasetKey || "unknown"}`,
    `Loaded rows: ${manifest.rowCount}`,
    `Loaded groups: ${manifest.groupCount}`,
    `Training labels: ${manifest.labelCount}`,
    `Separated records: ${manifest.separationCount || 0}`,
    "",
    "## Requested Action",
    "",
    manifest.requestedAction,
    "",
    "## Source Dataset",
    "",
    `- Endpoint: ${sourceDataset.endpoint || "unknown"}`,
    `- File name: ${sourceDataset.fileName || "unknown"}`,
    `- Display name: ${sourceDataset.displayName || "unknown"}`,
    `- Object type: ${sourceDataset.objectType || "unknown"}`,
    `- Format: ${sourceDataset.format || "unknown"}`,
    "",
    "## Files",
    "",
    `- Latest labels CSV: ${manifest.latestCsvPath}`,
    `- Timestamped labels CSV: ${manifest.csvPath}`,
    `- Latest separated-record JSON: ${manifest.latestSeparatedPath}`,
    `- Timestamped separated-record JSON: ${manifest.separatedPath}`,
    `- Latest manifest: ${path.join(OUTPUT_DIR, "codex-training-labels-latest.json")}`,
    "",
    "## Instructions For Codex",
    "",
    "1. Read the latest labels CSV and separated-record JSON and compare the user's decisions against the app's current scoring output.",
    "2. Treat separated records as strong negative evidence against the active records in their original groups unless the source data clearly contradicts that manual split.",
    "3. Identify systematic false positives, false negatives, and unsure cases that point to scoring or blocking issues.",
    "4. Make conservative code changes to the duplicate matching logic so the labeled examples are handled better without overfitting.",
    "5. Run the relevant syntax checks/tests and summarize what changed.",
    ""
  ].join("\n");
}

function sanitizeCodexSourceDataset(sourceDataset) {
  if (!sourceDataset || typeof sourceDataset !== "object") {
    return {
      endpoint: "",
      fileName: "",
      displayName: "",
      objectType: "",
      format: ""
    };
  }

  return {
    endpoint: String(sourceDataset.endpoint || ""),
    fileName: String(sourceDataset.fileName || ""),
    displayName: String(sourceDataset.displayName || ""),
    objectType: String(sourceDataset.objectType || ""),
    format: String(sourceDataset.format || "")
  };
}

async function openCodexTrainingSession(requestPath) {
  const prompt = `Read ${requestPath} and carry out the requested Duplicate Reviewer matching-logic evaluation and conservative improvements.`;
  const codexCommand = buildCodexTrainingCommand({
    codexBin: CODEX_BIN,
    rootDir: ROOT_DIR,
    prompt,
    model: CODEX_MODEL,
    reasoningEffort: CODEX_REASONING_EFFORT
  });
  const command = [
    `cd ${shellQuote(ROOT_DIR)}`,
    codexCommand
  ].join(" && ");
  const script = [
    'tell application "Terminal"',
    `  do script ${appleScriptString(command)}`,
    "  activate",
    "end tell"
  ].join("\n");

  await runAppleScript(script);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function notify(title, message, { sticky = false } = {}) {
  await runAppleScript(`display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`);
  if (sticky) {
    runAppleScriptDetached(
      `display alert ${appleScriptString(title)} message ${appleScriptString(message)} as informational buttons {"Close"} default button "Close"`
    );
  }
}

function runAppleScript(script) {
  return new Promise((resolve) => {
    childProcess.execFile(
      "/usr/bin/osascript",
      ["-e", script],
      () => resolve()
    );
  });
}

function runAppleScriptDetached(script) {
  const child = childProcess.spawn("/usr/bin/osascript", ["-e", script], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function sendJson(response, value, status = 200, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function fileModeCorsHeaders(request) {
  return request.headers.origin === "null"
    ? {
        "Access-Control-Allow-Origin": "null",
        Vary: "Origin"
      }
    : {};
}

function sendError(response, error) {
  const status = error.status || 500;
  const details = error.details && typeof error.details === "object" ? error.details : {};
  const code = error.code || details.code || defaultErrorCode(status);
  if (status >= 500) logServerError(error, { status, code, detailKeys: Object.keys(details) });
  const { code: _ignoredCode, ...responseDetails } = details;
  sendJson(response, { error: { code, message: error.message || "Internal server error", ...responseDetails } }, status);
}

function httpError(status, message, details = null) {
  const error = new Error(message);
  error.status = status;
  if (details?.code) error.code = details.code;
  if (details) error.details = details;
  return error;
}

function defaultErrorCode(status) {
  return {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    500: "INTERNAL_ERROR",
    502: "UPSTREAM_ERROR"
  }[status] || "APP_ERROR";
}

function logServerError(error, context = {}) {
  console.error(JSON.stringify({
    level: "error",
    at: new Date().toISOString(),
    appId: "salesforce-duplicate-reviewer",
    code: context.code || defaultErrorCode(error.status || 500),
    status: context.status || error.status || 500,
    message: error.message || "Internal server error",
    detailKeys: context.detailKeys || []
  }));
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}
