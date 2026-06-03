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
const APP_ID = "salesforce-duplicate-reviewer";
const API_CONTRACT_VERSION = "duplicate-reviewer-api-contract-v2";
const REQUEST_TIMEOUT_MS = Number(process.env.DUPLICATE_REVIEWER_CONTRACT_TIMEOUT_MS || 5000);

let serverProcess = null;
let fakeSalesforceServer = null;
let tempDir = "";

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-reviewer-contracts-"));
  fakeSalesforceServer = await startFakeSalesforceServer();
  const fakeSalesforceCli = await writeFakeSalesforceCli(tempDir, fakeSalesforceServer.baseUrl);
  const contactsCsvPath = path.join(tempDir, "contacts-latest.csv");
  const accountsCsvPath = path.join(tempDir, "accounts-latest.csv");
  await writeSmokeDataset(contactsCsvPath, "003T00000090001", "003T00000090002");
  await writeSmokeDataset(accountsCsvPath, "001T00000090001", "001T00000090002");

  serverProcess = childProcess.spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DUPLICATE_REVIEWER_STATIC_DIR: PUBLIC_DIR,
      STAGING_CONTACTS_CSV: contactsCsvPath,
      STAGING_ACCOUNTS_CSV: accountsCsvPath,
      SF_CLI_BIN: fakeSalesforceCli,
      SF_ORG_ALIAS: "smoke-org",
      SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
      SF_API_VERSION: "v67.0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = captureProcessLogs(serverProcess);
  try {
    const health = await waitForHealth(baseUrl, logs);
    assertEqual(health.appId, APP_ID, "health appId");
    assertEqual(health.featureVersion, readServerFeatureVersion(), "health featureVersion");
    assertEqual(health.apiContractVersion, API_CONTRACT_VERSION, "health apiContractVersion");
    assertEqual(health.salesforceMerge, true, "health salesforceMerge");
    assertEqual(health.salesforcePreMergeCheck, true, "health salesforcePreMergeCheck");
    assertEqual(health.salesforceCliWarningSafe, true, "health salesforceCliWarningSafe");
    assertEqual(health.salesforceCliApiVersionEnvIsolated, true, "health salesforceCliApiVersionEnvIsolated");
    assertEqual(health.latestStagingFiles, true, "health latestStagingFiles");
    assertEqual(health.jsonDatasets, true, "health jsonDatasets");

    await assertStaticApp(baseUrl);
    await assertLatestEndpointCaching(baseUrl);
    await assertUnsupportedMergeRoute(baseUrl, "/api/salesforce/premerge-check");
    await assertUnsupportedMergeRoute(baseUrl, "/api/salesforce/merge");
    await assertSalesforcePreMergeWithWarningCli(baseUrl);
    await assertSalesforceMergeWithWarningCli(baseUrl);
  } finally {
    await stopProcess(serverProcess);
    await stopFakeSalesforceServer(fakeSalesforceServer);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("Server contract checks passed.");
}

async function assertLatestEndpointCaching(baseUrl) {
  const first = await requestText(`${baseUrl}/api/staging-contacts/latest.json`);
  const etag = first.headers.etag;
  if (first.statusCode !== 200 || !etag || !first.body.includes("salesforce-duplicate-reviewer.dataset")) {
    throw new Error(`Latest JSON cache contract failed: HTTP ${first.statusCode}: ${first.body}`);
  }

  const second = await requestText(`${baseUrl}/api/staging-contacts/latest.json`, {
    headers: { "If-None-Match": etag }
  });
  if (second.statusCode !== 304) {
    throw new Error(`Latest JSON cache revalidation failed: HTTP ${second.statusCode}: ${second.body}`);
  }
}

async function writeSmokeDataset(csvPath, firstId, secondId) {
  const csv = [
    "Id,Name,Email",
    `${firstId},Smoke Record,smoke@example.com`,
    `${secondId},Smoke Record Copy,smoke@example.com`
  ].join("\n");
  await fs.writeFile(csvPath, csv);
  await fs.writeFile(csvPath.replace(/\.csv$/i, ".json"), JSON.stringify({
    columns: ["Id", "Name", "Email"],
    rows: [
      [firstId, "Smoke Record", "smoke@example.com"],
      [secondId, "Smoke Record Copy", "smoke@example.com"]
    ]
  }, null, 2));
}

async function waitForHealth(baseUrl, logs) {
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Duplicate Reviewer server exited before health was ready.\n${logs.join("\n")}`);
    }

    try {
      return await requestJson(`${baseUrl}/api/health`);
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Duplicate Reviewer server did not become healthy.\n${logs.join("\n")}`);
}

async function assertStaticApp(baseUrl) {
  const response = await requestText(`${baseUrl}/`);
  if (response.statusCode !== 200 || !response.body.includes("Salesforce Account and Contact Matching")) {
    throw new Error(`Static app contract failed: HTTP ${response.statusCode}`);
  }
}

async function assertUnsupportedMergeRoute(baseUrl, routePath) {
  const response = await requestText(`${baseUrl}${routePath}`, {
    method: "POST",
    body: { objectType: "account" }
  });
  if (response.statusCode !== 400 || !response.body.includes("Only Contact merges are supported")) {
    throw new Error(`${routePath} contract failed: HTTP ${response.statusCode}: ${response.body}`);
  }
  assertErrorCode(response, "BAD_REQUEST", routePath);
}

async function assertSalesforcePreMergeWithWarningCli(baseUrl) {
  const payload = smokeMergePayload();
  const response = await requestText(`${baseUrl}/api/salesforce/premerge-check`, {
    method: "POST",
    body: payload
  });
  if (response.statusCode !== 200) {
    throw new Error(`Warning CLI pre-merge contract failed: HTTP ${response.statusCode}: ${response.body}`);
  }

  const body = JSON.parse(response.body);
  if (body.status !== "fresh" || body.orgAlias !== "smoke-org" || body.instanceUrl !== fakeSalesforceServer.baseUrl) {
    throw new Error(`Warning CLI pre-merge contract returned unexpected body: ${response.body}`);
  }
}

async function assertSalesforceMergeWithWarningCli(baseUrl) {
  const payload = {
    ...smokeMergePayload(),
    masterFields: { LeadSource: "Web" },
    confirmation: "MERGE"
  };
  const response = await requestText(`${baseUrl}/api/salesforce/merge`, {
    method: "POST",
    body: payload
  });
  if (response.statusCode !== 200) {
    throw new Error(`Warning CLI merge contract failed: HTTP ${response.statusCode}: ${response.body}`);
  }

  const body = JSON.parse(response.body);
  if (
    body.status !== "success" ||
    body.masterId !== payload.masterId ||
    !Array.isArray(body.mergedRecordIds) ||
    !body.mergedRecordIds.includes(payload.mergeIds[0])
  ) {
    throw new Error(`Warning CLI merge contract returned unexpected body: ${response.body}`);
  }
}

function smokeMergePayload() {
  return {
    objectType: "contact",
    groupKey: "smoke-merge-group",
    masterId: "003T00000090001",
    mergeIds: ["003T00000090002"],
    records: [
      {
        id: "003T00000090001",
        name: "Smoke Record",
        rowIndex: 0,
        fields: {
          fullName: "Smoke Record",
          firstName: "Smoke",
          lastName: "Record",
          company: "Smoke Account",
          email: "smoke@example.com",
          leadSource: "Web",
          phone: "(555) 010-0001",
          mobile: ""
        }
      },
      {
        id: "003T00000090002",
        name: "Smoke Record Copy",
        rowIndex: 1,
        fields: {
          fullName: "Smoke Record Copy",
          firstName: "Smoke",
          lastName: "Record Copy",
          company: "Smoke Account",
          email: "smoke-copy@example.com",
          leadSource: "Referral",
          phone: "",
          mobile: "(555) 010-0002"
        }
      }
    ]
  };
}

function assertErrorCode(response, expectedCode, label) {
  const body = JSON.parse(response.body);
  if (body.error?.code !== expectedCode) {
    throw new Error(`${label} expected error code ${expectedCode}: ${response.body}`);
  }
}

function startFakeSalesforceServer() {
  return new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      requests.push({ method: request.method, path: url.pathname });

      if (request.method === "GET" && url.pathname === "/services/data/v67.0/queryAll") {
        sendFakeJson(response, { totalSize: 2, done: true, records: fakeSalesforceContactRecords() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/services/Soap/u/67.0") {
        readRequestBody(request).then(() => {
          response.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
          response.end(fakeSalesforceMergeSoapResponse());
        }).catch((error) => {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          response.end(error.message || "fake Salesforce SOAP read failed");
        });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ message: `Unexpected fake Salesforce route: ${request.method} ${url.pathname}` }));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        requests,
        baseUrl: `http://127.0.0.1:${port}`
      });
    });
  });
}

async function writeFakeSalesforceCli(directory, instanceUrl) {
  const payload = JSON.stringify({
    status: 0,
    result: {
      accessToken: "smoke-access-token",
      instanceUrl,
      username: "smoke.user@example.com",
      alias: "smoke-org"
    }
  });
  const cliPath = path.join(directory, process.platform === "win32" ? "sf.cmd" : "sf");
  const warningLines = [
    "Warning: @salesforce/cli update available from 2.134.6 to 2.136.8.",
    "node warning: org-api-version configuration overridden at v67.0"
  ];

  if (process.platform === "win32") {
    await fs.writeFile(cliPath, [
      "@echo off",
      "if defined SF_API_VERSION echo SF_API_VERSION leaked to sf org display 1>&2 && exit /b 2",
      "if defined SF_ORG_API_VERSION echo SF_ORG_API_VERSION leaked to sf org display 1>&2 && exit /b 2",
      "if defined SFDX_API_VERSION echo SFDX_API_VERSION leaked to sf org display 1>&2 && exit /b 2",
      ...warningLines.map((line) => `echo ${line} 1>&2`),
      `echo ${payload}`,
      "exit /b 1",
      ""
    ].join("\r\n"));
    return cliPath;
  }

  await fs.writeFile(cliPath, [
    "#!/bin/sh",
    "if [ -n \"${SF_API_VERSION:-}\" ] || [ -n \"${SF_ORG_API_VERSION:-}\" ] || [ -n \"${SFDX_API_VERSION:-}\" ]; then",
    "  printf '%s\\n' 'Salesforce API version env leaked to sf org display' >&2",
    "  exit 2",
    "fi",
    ...warningLines.map((line) => `printf '%s\\n' '${line}' >&2`),
    `printf '%s\\n' '${payload}'`,
    "exit 1",
    ""
  ].join("\n"));
  await fs.chmod(cliPath, 0o755);
  return cliPath;
}

function fakeSalesforceContactRecords() {
  return [
    {
      Id: "003T00000090001",
      IsDeleted: false,
      CreatedDate: "2026-01-01T00:00:00.000+0000",
      LastModifiedDate: "2026-01-01T00:00:00.000+0000",
      SystemModstamp: "2026-01-01T00:00:00.000+0000",
      Name: "Smoke Record",
      FirstName: "Smoke",
      LastName: "Record",
      Email: "smoke@example.com",
      LeadSource: "Web",
      Phone: "(555) 010-0001",
      MobilePhone: "",
      AccountId: "001T00000090001",
      Account: { Name: "Smoke Account" }
    },
    {
      Id: "003T00000090002",
      IsDeleted: false,
      CreatedDate: "2026-01-01T00:00:00.000+0000",
      LastModifiedDate: "2026-01-01T00:00:00.000+0000",
      SystemModstamp: "2026-01-01T00:00:00.000+0000",
      Name: "Smoke Record Copy",
      FirstName: "Smoke",
      LastName: "Record Copy",
      Email: "smoke-copy@example.com",
      LeadSource: "Referral",
      Phone: "",
      MobilePhone: "(555) 010-0002",
      AccountId: "001T00000090001",
      Account: { Name: "Smoke Account" }
    }
  ];
}

function fakeSalesforceMergeSoapResponse() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">',
    "  <soapenv:Body>",
    '    <mergeResponse xmlns="urn:partner.soap.sforce.com">',
    "      <result>",
    "        <id>003T00000090001</id>",
    "        <success>true</success>",
    "        <mergedRecordIds>003T00000090002</mergedRecordIds>",
    "        <updatedRelatedIds>00TT00000090001</updatedRelatedIds>",
    "      </result>",
    "    </mergeResponse>",
    "  </soapenv:Body>",
    "</soapenv:Envelope>"
  ].join("\n");
}

function sendFakeJson(response, body) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function stopFakeSalesforceServer(fakeServer) {
  if (!fakeServer?.server?.listening) return Promise.resolve();
  return new Promise((resolve) => fakeServer.server.close(resolve));
}

function readServerFeatureVersion() {
  return require("node:fs")
    .readFileSync(path.join(PROJECT_DIR, SERVER_SCRIPT), "utf8")
    .match(/const FEATURE_VERSION = "([^"]+)"/)?.[1] || "";
}

function requestJson(url, options) {
  return requestText(url, options).then((response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
    }
    return JSON.parse(response.body);
  });
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? "" : JSON.stringify(options.body);
    const request = http.request(url, {
      method: options.method || "GET",
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        ...(options.headers || {}),
        ...(body ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
        } : {})
      }
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode || 0, headers: response.headers, body: responseBody });
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timed out")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function captureProcessLogs(processHandle) {
  const lines = [];
  const append = (streamName, chunk) => {
    String(chunk || "").split(/\r?\n/).filter(Boolean).forEach((line) => {
      lines.push(`[${streamName}] ${line}`);
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

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  if (process.platform === "win32") {
    childProcess.spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => processHandle.once("exit", resolve)),
    delay(3000).then(() => {
      if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    })
  ]);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
