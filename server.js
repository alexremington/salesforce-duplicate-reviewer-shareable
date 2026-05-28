#!/usr/bin/env node

const childProcess = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
loadDotEnv(path.join(ROOT_DIR, ".env"));
const STATIC_ROOT_DIR = path.resolve(process.env.DUPLICATE_REVIEWER_STATIC_DIR || ROOT_DIR);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5180);
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
const SF_ORG_ALIAS = process.env.SF_ORG_ALIAS || "politico-staging";
const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL || "https://politico--staging.sandbox.my.salesforce.com";
const SF_API_VERSION = process.env.SF_API_VERSION || "v67.0";
const SF_CLI_BIN = process.env.SF_CLI_BIN || "sf";
const MERGE_AUDIT_LOG = path.join(OUTPUT_DIR, "salesforce-merge-log.jsonl");
const MAX_MERGE_VICTIMS = 20;
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const MERGE_MASTER_FIELD_ALLOWLIST = new Set(["LeadSource"]);
const MERGE_MASTER_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

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

async function stagingLatestFiles() {
  const files = await Promise.all(
    [...CSV_ENDPOINTS.entries()].map(async ([endpointPath, endpoint]) => {
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

  if (!endpoint.jsonPath) return null;
  try {
    return await fs.stat(endpoint.jsonPath);
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

async function mergeSalesforceRecords(body) {
  const mergeRequest = validateMergeRequest(body);
  const auditBase = {
    requestedAt: new Date().toISOString(),
    objectType: mergeRequest.objectType,
    groupKey: mergeRequest.groupKey,
    masterId: mergeRequest.masterId,
    mergeIds: mergeRequest.mergeIds,
    masterFields: mergeRequest.masterFields,
    masterFieldsToNull: mergeRequest.masterFieldsToNull,
    orgAlias: SF_ORG_ALIAS
  };

  try {
    const auth = await getSalesforceAuth();
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
      mergedAt: new Date().toISOString()
    };
    await appendMergeAudit({ ...auditBase, status: "success", response });
    return response;
  } catch (error) {
    await appendMergeAudit({ ...auditBase, status: "failed", error: error.message || "Merge failed" }).catch(() => {});
    throw error;
  }
}

function validateMergeRequest(body) {
  const objectType = normalizeMergeObjectType(body.objectType);
  const masterId = normalizeSalesforceId(body.masterId);
  const mergeIds = uniqueIds(Array.isArray(body.mergeIds) ? body.mergeIds : []).filter((id) => id !== masterId);
  const masterFields = validateMergeMasterFields(body.masterFields);
  const masterFieldsToNull = validateMergeMasterFieldsToNull(body.masterFieldsToNull, masterFields);
  const expectedPrefix = "003";

  if (body.confirmation !== "MERGE") throw httpError(400, "Type MERGE to confirm this Salesforce merge.");
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
    groupKey: String(body.groupKey || "")
  };
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

  const display = await execFileJson(SF_CLI_BIN, ["org", "display", "--target-org", SF_ORG_ALIAS, "--json"], {
    env: {
      ...process.env,
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      SF_USE_GENERIC_UNIX_KEYCHAIN: process.env.SF_USE_GENERIC_UNIX_KEYCHAIN || "true"
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
        reject(httpError(500, `Salesforce CLI command failed: ${stderr || error.message}`));
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
  sendJson(response, { error: { message: error.message || "Internal server error" } }, status);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
