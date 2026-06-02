#!/usr/bin/env node

const childProcess = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
loadDotEnv(path.join(ROOT_DIR, ".env"));
const STATIC_ROOT_DIR = path.resolve(process.env.DUPLICATE_REVIEWER_STATIC_DIR || ROOT_DIR);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.DUPLICATE_REVIEWER_PORT || process.env.PORT || 5180);
const OUTPUT_DIR = path.join(ROOT_DIR, "Output");
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.5";
const CODEX_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || "xhigh";
const CODEX_TARGET_SESSION_ID = process.env.CODEX_TARGET_SESSION_ID || "";
const CODEX_TARGET_SESSION_ID_FILE =
  process.env.CODEX_TARGET_SESSION_ID_FILE ||
  path.join(OUTPUT_DIR, "codex-target-session-id.txt");
const STAGING_CONTACTS_CSV =
  process.env.STAGING_CONTACTS_CSV ||
  path.join(OUTPUT_DIR, "staging-contacts", "salesforce-report-latest.csv");
const STAGING_ACCOUNTS_CSV =
  process.env.STAGING_ACCOUNTS_CSV ||
  path.join(OUTPUT_DIR, "staging-accounts", "salesforce-report-latest.csv");
const SF_ORG_ALIAS = process.env.SF_ORG_ALIAS || "your-org-alias";
const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL || "https://your-domain.my.salesforce.com";
const SF_API_VERSION = process.env.SF_API_VERSION || "v67.0";
const SF_CLI_BIN = String(process.env.SF_CLI_BIN || "").trim();
const DEFAULT_PATH = defaultCommandPath();
let salesforceCliCommandCache = null;
const MERGE_AUDIT_LOG = path.join(OUTPUT_DIR, "salesforce-merge-log.jsonl");
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

const CSV_ENDPOINTS = new Map([
  [
    "/api/staging-contacts/latest.csv",
    {
      path: STAGING_CONTACTS_CSV,
      jsonPath: STAGING_CONTACTS_CSV.replace(/\.csv$/i, ".json"),
      fileName: "salesforce-report-latest.csv",
      objectType: "contact",
      label: "Latest Contacts"
    }
  ],
  [
    "/api/staging-accounts/latest.csv",
    {
      path: STAGING_ACCOUNTS_CSV,
      jsonPath: STAGING_ACCOUNTS_CSV.replace(/\.csv$/i, ".json"),
      fileName: "salesforce-report-latest.csv",
      objectType: "account",
      label: "Latest Accounts"
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
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendError(response, error);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Salesforce Duplicate Reviewer running at http://${HOST}:${PORT}`);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, {
      ok: true,
      appId: "salesforce-duplicate-reviewer",
      stickyNotifications: true,
      stagingAccounts: true,
      latestStagingFiles: true,
      jsonDatasets: true,
      staticAssetRoot: Boolean(process.env.DUPLICATE_REVIEWER_STATIC_DIR),
      svgStaticAssets: true,
      brandLogoAsset: true,
      brandHeaderVersion: "shared-logo-contact-v1",
      sharedBrandLogo: true,
      headerContact: true,
      salesforceMerge: true,
      salesforceMergeObjectTypes: ["Contact"],
      pid: process.pid,
      port: PORT
    }, 200, fileModeCorsHeaders(request));
    return;
  }

  if (request.method === "GET" && CSV_ENDPOINTS.has(url.pathname)) {
    const endpoint = CSV_ENDPOINTS.get(url.pathname);
    const data = await readCsvEndpointData(endpoint);
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="${endpoint.fileName}"`,
      "Cache-Control": "no-store"
    });
    response.end(data);
    return;
  }

  if (request.method === "GET" && JSON_ENDPOINTS.has(url.pathname)) {
    const endpoint = JSON_ENDPOINTS.get(url.pathname);
    const data = await readJsonEndpointData(endpoint);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `inline; filename="${endpoint.fileName}"`,
      "Cache-Control": "no-store"
    });
    response.end(`${JSON.stringify(data)}\n`);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/staging/latest-files") {
    const files = await stagingLatestFiles();
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
    const result = await mergeSalesforceRecords(body);
    sendJson(response, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/salesforce/premerge-check") {
    const body = await readJsonBody(request, 256 * 1024);
    const result = await checkSalesforcePreMergeFreshness(body);
    sendJson(response, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/codex/training-labels") {
    const body = await readJsonBody(request, 25 * 1024 * 1024);
    const rows = validateTrainingLabelRows(body.rows);
    const receivedAt = new Date();
    const timestamp = timestampForFileName(receivedAt);
    const csv = rowsToCsv(rows);
    const labelCount = Math.max(0, rows.length - 1);
    const csvFileName = `codex-training-labels-${timestamp}.csv`;
    const csvPath = path.join(OUTPUT_DIR, csvFileName);
    const latestCsvPath = path.join(OUTPUT_DIR, "codex-training-labels-latest.csv");
    const manifestPath = path.join(OUTPUT_DIR, "codex-training-labels-latest.json");
    const requestPath = path.join(OUTPUT_DIR, `codex-training-request-${timestamp}.md`);
    const latestRequestPath = path.join(OUTPUT_DIR, "codex-training-request-latest.md");
    const requestedAction = String(
      body.requestedAction ||
        "Read the latest training-label CSV, evaluate where the duplicate matching logic disagrees with the labels, and improve the matching/scoring logic safely."
    );
    const manifest = {
      receivedAt: receivedAt.toISOString(),
      objectType: String(body.objectType || ""),
      fileName: String(body.fileName || ""),
      datasetKey: String(body.datasetKey || ""),
      rowCount: Number(body.rowCount || 0),
      groupCount: Number(body.groupCount || 0),
      labelCount,
      requestedAction,
      csvPath,
      latestCsvPath,
      requestPath,
      latestRequestPath
    };
    const requestMarkdown = buildCodexTrainingRequest(manifest);

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(csvPath, csv);
    await fs.writeFile(latestCsvPath, csv);
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
      csvPath,
      latestCsvPath,
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

async function stagingLatestFiles() {
  const files = await Promise.all(
    [...JSON_ENDPOINTS.entries()].map(async ([endpointPath, endpoint]) => {
      const stat = await latestEndpointStat(endpoint);
      if (!stat) return null;

      return {
        source: endpointPath.includes("accounts") ? "staging-accounts" : "staging-contacts",
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
        name: endpoint.label
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
      format
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

async function checkSalesforcePreMergeFreshness(body) {
  const mergeRequest = validateMergeRequest(body, { requireConfirmation: false });
  const auth = await getSalesforceAuth();
  return buildPreMergeFreshnessResult({
    auth,
    objectType: mergeRequest.objectType,
    groupKey: mergeRequest.groupKey,
    masterId: mergeRequest.masterId,
    mergeIds: mergeRequest.mergeIds,
    loadedRecords: mergeRequest.loadedRecords
  });
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
    orgAlias: SF_ORG_ALIAS
  };

  try {
    const auth = await getSalesforceAuth();
    const preMergeCheck = await buildPreMergeFreshnessResult({
      auth,
      objectType: mergeRequest.objectType,
      groupKey: mergeRequest.groupKey,
      masterId: mergeRequest.masterId,
      mergeIds: mergeRequest.mergeIds,
      loadedRecords: mergeRequest.loadedRecords
    });
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
      preMergeCheck,
      recoverySnapshot: buildMergeRecoverySnapshot(preMergeCheck),
      mergedAt: new Date().toISOString()
    };
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
  const requireConfirmation = options.requireConfirmation !== false;
  const objectType = normalizeMergeObjectType(body.objectType);
  const masterId = normalizeSalesforceId(body.masterId);
  const mergeIds = uniqueIds(Array.isArray(body.mergeIds) ? body.mergeIds : []).filter((id) => id !== masterId);
  const masterFields = validateMergeMasterFields(body.masterFields);
  const masterFieldsToNull = validateMergeMasterFieldsToNull(body.masterFieldsToNull, masterFields);
  const loadedRecords = validatePreMergeLoadedRecords(body.records);
  const expectedPrefix = "003";

  if (requireConfirmation && body.confirmation !== "MERGE") throw httpError(400, "Type MERGE to confirm this Salesforce merge.");
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
    groupKey: String(body.groupKey || "")
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
    return {
      id,
      name: String(record.name || ""),
      rowIndex: Number.isFinite(Number(record.rowIndex)) ? Number(record.rowIndex) : null,
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

async function getSalesforceAuth() {
  const envAccessToken = process.env.SF_ACCESS_TOKEN;
  if (envAccessToken) {
    return {
      accessToken: envAccessToken,
      instanceUrl: normalizeInstanceUrl(SF_INSTANCE_URL),
      apiVersion: normalizeApiVersion(SF_API_VERSION),
      orgAlias: SF_ORG_ALIAS
    };
  }

  const display = await execFileJson(salesforceCliCommand(), ["org", "display", "--target-org", SF_ORG_ALIAS, "--json"], {
    env: {
      ...process.env,
      ...(DEFAULT_PATH ? { PATH: DEFAULT_PATH, Path: process.platform === "win32" ? DEFAULT_PATH : process.env.Path } : {}),
      ...(process.platform === "win32" ? {} : { SF_USE_GENERIC_UNIX_KEYCHAIN: process.env.SF_USE_GENERIC_UNIX_KEYCHAIN || "true" })
    }
  });
  const result = display.result || {};
  if (!result.accessToken) throw httpError(500, `Salesforce CLI did not return an access token for ${SF_ORG_ALIAS}.`);

  return {
    accessToken: result.accessToken,
    instanceUrl: normalizeInstanceUrl(SF_INSTANCE_URL || result.instanceUrl),
    apiVersion: normalizeApiVersion(SF_API_VERSION),
    orgAlias: SF_ORG_ALIAS
  };
}

function execFileJson(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { maxBuffer: 10 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(salesforceCliError("Salesforce CLI command failed", error, stdout, stderr));
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

function salesforceCliCommand() {
  if (salesforceCliCommandCache) return salesforceCliCommandCache;

  const candidates = SF_CLI_BIN ? [SF_CLI_BIN] : salesforceCliCandidates();
  for (const candidate of candidates) {
    const resolved = resolveExecutable(candidate);
    if (resolved) {
      salesforceCliCommandCache = resolved;
      return salesforceCliCommandCache;
    }
  }

  salesforceCliCommandCache = SF_CLI_BIN || defaultSalesforceCliName();
  return salesforceCliCommandCache;
}

function salesforceCliCandidates() {
  if (process.platform === "win32") {
    return [
      "sf.cmd",
      "sf.exe",
      "sf",
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "sf", "bin", "sf.cmd"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Salesforce CLI", "bin", "sf.cmd"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "sf", "bin", "sf.cmd"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Salesforce CLI", "bin", "sf.cmd"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "sf", "bin", "sf.cmd"),
      process.env.APPDATA && path.join(process.env.APPDATA, "npm", "sf.cmd"),
      path.join(os.homedir(), "AppData", "Roaming", "npm", "sf.cmd")
    ].filter(Boolean);
  }

  return [
    "sf",
    "/usr/local/bin/sf",
    "/opt/homebrew/bin/sf"
  ];
}

function defaultSalesforceCliName() {
  return process.platform === "win32" ? "sf.cmd" : "sf";
}

function resolveExecutable(command) {
  const candidate = String(command || "").trim().replace(/^["']|["']$/g, "");
  if (!candidate) return "";

  if (isPathLike(candidate)) {
    return executablePath(candidate);
  }

  for (const folder of commandSearchPaths()) {
    for (const executableName of executableNames(candidate)) {
      const resolved = executablePath(path.join(folder, executableName));
      if (resolved) return resolved;
    }
  }

  return "";
}

function executablePath(filePath) {
  for (const candidate of executablePathCandidates(expandHome(filePath))) {
    try {
      const stat = fsSync.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Keep trying candidate executable paths.
    }
  }

  return "";
}

function executablePathCandidates(filePath) {
  if (process.platform !== "win32" || path.extname(filePath)) return [filePath];
  return [`${filePath}.cmd`, `${filePath}.exe`, `${filePath}.bat`, filePath];
}

function executableNames(command) {
  if (process.platform !== "win32" || path.extname(command)) return [command];
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
}

function commandSearchPaths() {
  return uniquePathParts([
    process.env.Path,
    process.env.PATH,
    DEFAULT_PATH
  ].filter(Boolean).join(path.delimiter));
}

function isPathLike(value) {
  return path.isAbsolute(value) || /[\\/]/.test(value);
}

function salesforceCliError(message, error, stdout = "", stderr = "") {
  if (error?.code === "ENOENT") {
    return httpError(500, "Salesforce CLI was not found. Install Salesforce CLI or set SF_CLI_BIN in .env to the full path to sf, then restart Duplicate Reviewer.");
  }

  const detail = String(stderr || stdout || error?.message || "").trim();
  return httpError(500, detail ? `${message}: ${detail}` : message);
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
  if (!Array.isArray(rows) || rows.length < 2) {
    throw httpError(400, "Training label rows are required.");
  }
  if (!rows.every((row) => Array.isArray(row))) {
    throw httpError(400, "Training label rows must be arrays.");
  }
  return rows.map((row) => row.map((value) => String(value ?? "")));
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
    "",
    "## Requested Action",
    "",
    manifest.requestedAction,
    "",
    "## Files",
    "",
    `- Latest labels CSV: ${manifest.latestCsvPath}`,
    `- Timestamped labels CSV: ${manifest.csvPath}`,
    `- Latest manifest: ${path.join(OUTPUT_DIR, "codex-training-labels-latest.json")}`,
    "",
    "## Instructions For Codex",
    "",
    "1. Read the latest labels CSV and compare the user's decisions against the app's current scoring output.",
    "2. Identify systematic false positives, false negatives, and unsure cases that point to scoring or blocking issues.",
    "3. Make conservative code changes to the duplicate matching logic so the labeled examples are handled better without overfitting.",
    "4. Run the relevant syntax checks/tests and summarize what changed.",
    ""
  ].join("\n");
}

async function openCodexTrainingSession(requestPath) {
  const prompt = `Read ${requestPath} and carry out the requested Duplicate Reviewer matching-logic evaluation and conservative improvements.`;
  const modelArg = CODEX_MODEL ? ` --model ${shellQuote(CODEX_MODEL)}` : "";
  const reasoningArg = CODEX_REASONING_EFFORT
    ? ` -c ${shellQuote(`model_reasoning_effort="${CODEX_REASONING_EFFORT}"`)}`
    : "";
  const targetSessionId = await readCodexTargetSessionId();
  const codexCommand = targetSessionId
    ? `${shellQuote(CODEX_BIN)} resume --cd ${shellQuote(ROOT_DIR)}${modelArg}${reasoningArg} ${shellQuote(targetSessionId)} ${shellQuote(prompt)}`
    : `${shellQuote(CODEX_BIN)} --cd ${shellQuote(ROOT_DIR)}${modelArg}${reasoningArg} ${shellQuote(prompt)}`;
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

async function readCodexTargetSessionId() {
  const configuredSessionId = parseCodexSessionId(CODEX_TARGET_SESSION_ID);
  if (configuredSessionId) return configuredSessionId;

  try {
    const text = await fs.readFile(CODEX_TARGET_SESSION_ID_FILE, "utf8");
    return parseCodexSessionId(text);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function parseCodexSessionId(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && /^[0-9a-fA-F-]{20,}$/.test(line)) || "";
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
  if (status >= 500) console.error(error);
  sendJson(response, { error: { message: error.message || "Internal server error", ...(error.details || {}) } }, status);
}

function httpError(status, message, details = null) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
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

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}
