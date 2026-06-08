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
const RETIRED_MERGE_GATE_PATTERNS = [
  "merge-confirmation-input",
  "Type MERGE",
  'confirmation: "MERGE"',
  "mergeConfirmationValue"
];
const CACHED_STATIC_APP_PATH = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "salesforce-duplicate-reviewer", "static", "app.js")
  : "";
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

    await assertRetiredMergeGateAbsent();
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

async function assertRetiredMergeGateAbsent() {
  const sourceFiles = [
    path.join(PROJECT_DIR, "public", "app.js"),
    path.join(PROJECT_DIR, "server", "server.js"),
    path.join(PROJECT_DIR, "tests", "playwright-smoke.js"),
    path.join(PROJECT_DIR, "README.md")
  ];
  const checkedLocations = [];

  for (const filePath of sourceFiles) {
    const contents = await fs.readFile(filePath, "utf8");
    checkedLocations.push(filePath);
    assertNoRetiredMergeGate(contents, filePath);
  }

  if (CACHED_STATIC_APP_PATH) {
    try {
      const cachedContents = await fs.readFile(CACHED_STATIC_APP_PATH, "utf8");
      checkedLocations.push(CACHED_STATIC_APP_PATH);
      assertNoRetiredMergeGate(cachedContents, CACHED_STATIC_APP_PATH);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return checkedLocations;
}

function assertNoRetiredMergeGate(contents, filePath) {
  for (const retiredPattern of RETIRED_MERGE_GATE_PATTERNS) {
    if (contents.includes(retiredPattern)) {
      throw new Error(
        `Retired merge-gate string ${JSON.stringify(retiredPattern)} found in ${filePath}. ` +
        "The merge report should not require the old typed MERGE confirmation or related UI state."
      );
    }
  }
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
  if (
    response.statusCode !== 200 ||
    !response.body.includes("Salesforce Account and Contact Matching") ||
    !response.body.includes('app.js?v=duplicate-reviewer-cli-warning-safe-v1')
  ) {
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
    masterFields: { LeadSource: "Web" }
  };
  const expectedMasterRecord = payload.records[0];
  const expectedDuplicateRecord = payload.records[1];
  const expectedRelatedId = "00TT00000090001CCC";
  const expectedMasterSourceRow = expectedMasterRecord.sourceRow;
  const expectedDuplicateSourceRow = expectedDuplicateRecord.sourceRow;
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
  if (
    !body.mergeReport ||
    !Array.isArray(body.mergeReport.rows) ||
    body.mergeReport.rows.length < 2 ||
    !body.mergeReport.csvPath ||
    !body.mergeReport.latestCsvPath
  ) {
    throw new Error(`Warning CLI merge contract did not return a merge report: ${response.body}`);
  }

  const reportCsv = await fs.readFile(body.mergeReport.csvPath, "utf8");
  const relatedRow = body.mergeReport.rows.find((row) => Array.isArray(row) && row[0] === "Related record");
  if (
    !reportCsv.includes("ROLE,Salesforce ID,Name,First Name,Last Name,Email,Lead Source,Phone,Mobile Phone,Account ID,Account Name,Created Date,Last Modified Date,System Modstamp,Is Deleted,STATUS,DETAILS") ||
    !reportCsv.includes(expectedMasterSourceRow["Contact ID 18"]) ||
    !reportCsv.includes("Alex") ||
    !reportCsv.includes("Alexander") ||
    !reportCsv.includes(expectedMasterSourceRow["First Name"]) ||
    !reportCsv.includes(expectedMasterSourceRow["Last Name"]) ||
    !reportCsv.includes(expectedMasterSourceRow["Email"]) ||
    !reportCsv.includes(expectedMasterSourceRow["Phone"]) ||
    !reportCsv.includes(expectedMasterSourceRow["Mobile"]) ||
    !reportCsv.includes(expectedMasterSourceRow["Account Name"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["Contact ID 18"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["First Name"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["Last Name"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["Email"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["Phone"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["Mobile"]) ||
    !reportCsv.includes(expectedDuplicateSourceRow["Account Name"]) ||
    !reportCsv.includes(expectedRelatedId) ||
    !reportCsv.includes("Retained as master") ||
    !reportCsv.includes("Merged into master")
  ) {
    throw new Error(`Warning CLI merge report file did not contain the expected statuses: ${reportCsv}`);
  }
  const masterRow = body.mergeReport.rows.find((row) => Array.isArray(row) && row[0] === "Master record");
  const duplicateRow = body.mergeReport.rows.find((row) => Array.isArray(row) && row[0] === "Duplicate record");
  if (!masterRow || masterRow[1] !== expectedMasterSourceRow["Contact ID 18"] || masterRow[3] !== "Alex" || masterRow[4] !== "Test" || masterRow[5] !== "afremington+test1@gmail.com" || masterRow[7] !== "6786655734" || masterRow[10] !== "[DO NOT USE] Peanut Butter & Co." || masterRow[6] !== "" || masterRow[8] !== "") {
    throw new Error(`Warning CLI merge report master row did not match the uploaded file values: ${JSON.stringify(masterRow)}`);
  }
  if (!duplicateRow || duplicateRow[1] !== expectedDuplicateSourceRow["Contact ID 18"] || duplicateRow[3] !== "Alexander" || duplicateRow[4] !== "Test" || duplicateRow[5] !== "afremington+test2@gmail.com" || duplicateRow[7] !== "6786655734" || duplicateRow[10] !== "[DO NOT USE] Peanut Butter & Co." || duplicateRow[6] !== "" || duplicateRow[8] !== "") {
    throw new Error(`Warning CLI merge report duplicate row did not match the uploaded file values: ${JSON.stringify(duplicateRow)}`);
  }
  if (!relatedRow || relatedRow[1] !== expectedRelatedId) {
    throw new Error(`Warning CLI merge report did not preserve the related Salesforce ID: ${JSON.stringify(relatedRow)}`);
  }
}

function smokeMergePayload() {
  return {
    objectType: "contact",
    groupKey: "smoke-merge-group",
    masterId: "003VZ0000132RgDYAU",
    mergeIds: ["003VZ0000132Rl3YAE"],
    records: [
      {
        id: "003VZ0000132RgDYAU",
        name: "Alex Test",
        rowIndex: 0,
        sourceRow: {
          "Contact ID 18": "003VZ0000132RgDYAU",
          "First Name": "Alex",
          "Last Name": "Test",
          "Account Name": "[DO NOT USE] Peanut Butter & Co.",
          "Mailing Street": "1000 Wilson Blvd",
          "Mailing City": "Arlington",
          "Mailing State/Province (text only)": "Virginia",
          "Mailing Zip/Postal Code": "",
          "Mailing Country (text only)": "United States",
          "Phone": "6786655734",
          "Fax": "",
          "Mobile": "",
          "Email": "afremington+test1@gmail.com",
          "Account Owner": "Kumuda Rajashekara",
          "Salutation": ""
        },
        fields: {
          fullName: "Alex Test",
          firstName: "Alex",
          lastName: "Test",
          company: "[DO NOT USE] Peanut Butter & Co.",
          email: "afremington+test1@gmail.com",
          phone: "6786655734",
          mobile: ""
        }
      },
      {
        id: "003VZ0000132Rl3YAE",
        name: "Alexander Test",
        rowIndex: 1,
        sourceRow: {
          "Contact ID 18": "003VZ0000132Rl3YAE",
          "First Name": "Alexander",
          "Last Name": "Test",
          "Account Name": "[DO NOT USE] Peanut Butter & Co.",
          "Mailing Street": "1000 Wilson Blvd",
          "Mailing City": "Arlington",
          "Mailing State/Province (text only)": "Virginia",
          "Mailing Zip/Postal Code": "",
          "Mailing Country (text only)": "United States",
          "Phone": "6786655734",
          "Fax": "",
          "Mobile": "",
          "Email": "afremington+test2@gmail.com",
          "Account Owner": "Kumuda Rajashekara",
          "Salutation": ""
        },
        fields: {
          fullName: "Alexander Test",
          firstName: "Alexander",
          lastName: "Test",
          company: "[DO NOT USE] Peanut Butter & Co.",
          email: "afremington+test2@gmail.com",
          phone: "6786655734",
          mobile: ""
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
      Id: "003VZ0000132RgDYAU",
      IsDeleted: false,
      CreatedDate: "2026-04-01T00:00:00.000+0000",
      LastModifiedDate: "2026-04-01T00:00:00.000+0000",
      SystemModstamp: "2026-04-01T00:00:00.000+0000",
      Name: "Alex Test",
      FirstName: "Alex",
      LastName: "Test",
      Email: "afremington+test1@gmail.com",
      LeadSource: "",
      Phone: "6786655734",
      MobilePhone: "",
      AccountId: "001T00000090011AAA",
      Account: { Name: "[DO NOT USE] Peanut Butter & Co." }
    },
    {
      Id: "003VZ0000132Rl3YAE",
      IsDeleted: false,
      CreatedDate: "2026-04-02T00:00:00.000+0000",
      LastModifiedDate: "2026-04-02T00:00:00.000+0000",
      SystemModstamp: "2026-04-02T00:00:00.000+0000",
      Name: "Alexander Test",
      FirstName: "Alexander",
      LastName: "Test",
      Email: "afremington+test2@gmail.com",
      LeadSource: "",
      Phone: "6786655734",
      MobilePhone: "",
      AccountId: "001T00000090022BBB",
      Account: { Name: "[DO NOT USE] Peanut Butter & Co." }
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
    "        <id>003VZ0000132RgDYAU</id>",
    "        <success>true</success>",
    "        <mergedRecordIds>003VZ0000132Rl3YAE</mergedRecordIds>",
    "        <updatedRelatedIds>00TT00000090001CCC</updatedRelatedIds>",
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
