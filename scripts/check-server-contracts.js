#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const vm = require("node:vm");
const { buildCodexTrainingCommand } = require("../server/codex-training");
const {
  DEFAULT_BENCHMARKS,
  generateContactModelEvaluationReport
} = require("./contact-model-evaluation-report");

const PROJECT_DIR = path.resolve(__dirname, "..");
const SERVER_SCRIPT = path.join("server", "server.js");
const PUBLIC_DIR = path.join(PROJECT_DIR, "public");
const RETIRED_MERGE_GATE_PATTERNS = [
  "merge-confirmation-input",
  "Type MERGE",
  'confirmation: "MERGE"',
  "mergeConfirmationValue"
];
const REQUIRED_MERGE_REVIEW_PATTERNS = [
  "mergeReviewSession",
  "renderMergeReviewPanel",
  "renderMergeConfirmationPreview",
  "startMergeReviewSession",
  "handleConfirmedMerge",
  "renderMergeSuccessPanel",
  "merge-success-panel"
];
const REQUIRED_MERGE_REVIEW_FILE_PATTERNS = new Map([
  [path.join(PROJECT_DIR, "public", "app.js"), REQUIRED_MERGE_REVIEW_PATTERNS],
  [path.join(PROJECT_DIR, "tests", "playwright-smoke.js"), [
    "reviewVisible",
    "confirmVisible",
    "cancelVisible",
    "mergeSentBeforeConfirm",
    "previewClearedAfterCancel",
    "mergeSentAfterCancel",
    "successPanelVisible",
    "mergeSubmitCountAfterSuccess",
    "payloadsAligned"
  ]]
]);
const CACHED_STATIC_APP_PATH = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "salesforce-duplicate-reviewer", "static", "app.js")
  : "";
const APP_ID = "salesforce-duplicate-reviewer";
const API_CONTRACT_VERSION = "duplicate-reviewer-api-contract-v2";
const REQUEST_TIMEOUT_MS = Number(process.env.DUPLICATE_REVIEWER_CONTRACT_TIMEOUT_MS || 5000);

let serverProcess = null;
let fakeSalesforceServer = null;
let fakeSalesforceCli = "";
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
  fakeSalesforceCli = await writeFakeSalesforceCli(tempDir, fakeSalesforceServer.baseUrl);
  const contactsCsvPath = path.join(tempDir, "contacts-latest.csv");
  const accountsCsvPath = path.join(tempDir, "accounts-latest.csv");
  const prodContactsCsvPath = path.join(tempDir, "prod-contacts-latest.csv");
  const prodAccountsCsvPath = path.join(tempDir, "prod-accounts-latest.csv");
  await writeSmokeDataset(contactsCsvPath, "003T00000090001", "003T00000090002");
  await writeSmokeDataset(accountsCsvPath, "001T00000090001", "001T00000090002");
  await writeSmokeDataset(prodContactsCsvPath, "003P00000090001", "003P00000090002");
  await writeSmokeDataset(prodAccountsCsvPath, "001P00000090001", "001P00000090002");

  serverProcess = childProcess.spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DUPLICATE_REVIEWER_STATIC_DIR: PUBLIC_DIR,
      STAGING_CONTACTS_CSV: contactsCsvPath,
      STAGING_ACCOUNTS_CSV: accountsCsvPath,
      PROD_CONTACTS_CSV: prodContactsCsvPath,
      PROD_ACCOUNTS_CSV: prodAccountsCsvPath,
      SF_CLI_BIN: fakeSalesforceCli,
      SF_ORG_ALIAS: "smoke-org",
      SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
      PROD_SF_ORG_ALIAS: "smoke-prod",
      PROD_SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
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
    assertEqual(health.latestProdFiles, true, "health latestProdFiles");
    assertEqual(health.jsonDatasets, true, "health jsonDatasets");
    assertEqual(health.prodAccounts, true, "health prodAccounts");
    assertEqual(health.salesforceAuthFresh, true, "health salesforceAuthFresh");
    assertEqual(health.runtimeAligned, true, "health runtimeAligned");

    await assertContactMirrorProvenanceGap();
    await assertRetiredMergeGateAbsent();
    await assertStaticApp(baseUrl);
    await assertLatestEndpointCaching(baseUrl);
    await assertProdLatestEndpointCaching(baseUrl);
    if (process.platform === "darwin") {
      await assertSchedulerReviewerForceRefreshRegression();
    }
    await assertSalesforceOrgCatalogRoute(baseUrl);
    await assertSalesforcePullReuseRegression();
    await assertSalesforcePullAuthPreflightRegression();
    await assertLauncherRuntimeAlignmentRegression();
    await assertCodexTrainingLaunchCommand(baseUrl);
    await assertTrimmedContactExportSchemaRegression();
    await assertAccountScopeDivergenceRegression();
    await assertAccountExactWebsiteCorroborationRegression();
    await assertAccountCommentaryNormalizationRegression();
    await assertContactSparseExactNameFloorRegression();
    await assertContactCompanyDifferenceVetoRegression();
    await assertContactLegacyComparisonRegression();
    await assertContactModelEvaluationReportRegression();
    await assertContactExactPhoneLinkedInDivergenceRegression();
    await assertContactSharedCompanyExactPhoneNameConflictRegression();
    await assertContactMirrorRelationshipRegression();
    await assertVisibleExcludedMirrorGroupRegression();
    await assertExcludedGroupDatasetExportRegression();
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
    assertRequiredMergeReviewFlow(contents, filePath);
  }

  if (CACHED_STATIC_APP_PATH) {
    try {
      const cachedContents = await fs.readFile(CACHED_STATIC_APP_PATH, "utf8");
      checkedLocations.push(CACHED_STATIC_APP_PATH);
      assertNoRetiredMergeGate(cachedContents, CACHED_STATIC_APP_PATH);
      assertRequiredMergeReviewFlow(cachedContents, CACHED_STATIC_APP_PATH);
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

function assertRequiredMergeReviewFlow(contents, filePath) {
  const requiredPatterns = REQUIRED_MERGE_REVIEW_FILE_PATTERNS.get(filePath)
    || (filePath === CACHED_STATIC_APP_PATH ? REQUIRED_MERGE_REVIEW_FILE_PATTERNS.get(path.join(PROJECT_DIR, "public", "app.js")) : null);
  if (!requiredPatterns) return;
  const missingPatterns = requiredPatterns.filter((pattern) => !contents.includes(pattern));
  if (missingPatterns.length) {
    throw new Error(
      `Merge review flow markers missing from ${filePath}: ${missingPatterns.map((pattern) => JSON.stringify(pattern)).join(", ")}. ` +
      "This usually means the queued review workflow was rolled back or renamed without updating the guardrail and smoke coverage."
    );
  }
}

async function assertLatestEndpointCaching(baseUrl) {
  const first = await requestText(`${baseUrl}/api/staging-contacts/latest.json`);
  const etag = first.headers.etag;
  if (first.statusCode !== 200 || !etag || !first.body.includes("salesforce-duplicate-reviewer.dataset")) {
    throw new Error(`Latest JSON cache contract failed: HTTP ${first.statusCode}: ${first.body}`);
  }
  const payload = JSON.parse(first.body);
  if (payload?.source?.orgAlias !== "smoke-org" || payload?.source?.instanceUrl !== fakeSalesforceServer.baseUrl) {
    throw new Error(`Latest JSON cache contract did not preserve source org metadata: ${first.body}`);
  }

  const accounts = await requestText(`${baseUrl}/api/staging-accounts/latest.json`);
  const accountsPayload = JSON.parse(accounts.body);
  if (accountsPayload?.source?.orgAlias !== "smoke-org" || accountsPayload?.source?.instanceUrl !== fakeSalesforceServer.baseUrl) {
    throw new Error(`Latest account JSON contract did not preserve source org metadata: ${accounts.body}`);
  }

  const second = await requestText(`${baseUrl}/api/staging-contacts/latest.json`, {
    headers: { "If-None-Match": etag }
  });
  if (second.statusCode !== 304) {
    throw new Error(`Latest JSON cache revalidation failed: HTTP ${second.statusCode}: ${second.body}`);
  }
}

async function assertProdLatestEndpointCaching(baseUrl) {
  const response = await requestText(`${baseUrl}/api/prod-contacts/latest.json`);
  if (response.statusCode !== 200 || !response.body.includes("salesforce-duplicate-reviewer.dataset")) {
    throw new Error(`Prod latest JSON cache contract failed: HTTP ${response.statusCode}: ${response.body}`);
  }

  const payload = JSON.parse(response.body);
  if (
    payload?.fileName !== "salesforce-report-latest.json" ||
    payload?.source?.name !== "Latest Prod Contacts" ||
    payload?.source?.orgAlias !== "smoke-prod" ||
    payload?.source?.instanceUrl !== fakeSalesforceServer.baseUrl
  ) {
    throw new Error(`Prod latest JSON cache contract did not preserve prod source metadata: ${response.body}`);
  }

  const accountsResponse = await requestText(`${baseUrl}/api/prod-accounts/latest.json`);
  if (accountsResponse.statusCode !== 200 || !accountsResponse.body.includes("salesforce-duplicate-reviewer.dataset")) {
    throw new Error(`Prod Accounts latest JSON cache contract failed: HTTP ${accountsResponse.statusCode}: ${accountsResponse.body}`);
  }

  const accountsPayload = JSON.parse(accountsResponse.body);
  if (
    accountsPayload?.fileName !== "salesforce-report-latest.json" ||
    accountsPayload?.source?.name !== "Latest Prod Accounts" ||
    accountsPayload?.source?.orgAlias !== "smoke-prod" ||
    accountsPayload?.source?.instanceUrl !== fakeSalesforceServer.baseUrl
  ) {
    throw new Error(`Prod Accounts latest JSON cache contract did not preserve prod source metadata: ${accountsResponse.body}`);
  }

  const latestFiles = await requestJson(`${baseUrl}/api/prod/latest-files`);
  const files = Array.isArray(latestFiles.files) ? latestFiles.files : [];
  const prodContact = files.find((file) => file.source === "prod-contacts");
  const prodAccounts = files.find((file) => file.source === "prod-accounts");
  if (
    !prodContact ||
    prodContact.endpoint !== "/api/prod-contacts/latest.json" ||
    prodContact.name !== "salesforce-report-latest.json" ||
    prodContact.label !== "Latest Prod Contacts" ||
    !prodAccounts ||
    prodAccounts.endpoint !== "/api/prod-accounts/latest.json" ||
    prodAccounts.name !== "salesforce-report-latest.json" ||
    prodAccounts.label !== "Latest Prod Accounts"
  ) {
    throw new Error(`Prod latest-files route failed: ${JSON.stringify(latestFiles)}`);
  }
}

async function assertSchedulerReviewerForceRefreshRegression() {
  const smokeRoot = path.join(tempDir, "scheduler-reviewer-force-refresh");
  const homeDir = path.join(smokeRoot, "home");
  const staticDir = path.join(homeDir, "Library", "Application Support", "salesforce-duplicate-reviewer", "static");
  const logsDir = path.join(homeDir, "Library", "Logs", "salesforce-duplicate-reviewer");
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const stagingContactsCsv = path.join(smokeRoot, "staging", "Output", "staging-contacts", "salesforce-report-latest.csv");
  const stagingAccountsCsv = path.join(smokeRoot, "staging", "Output", "staging-accounts", "salesforce-report-latest.csv");
  const prodContactsCsv = path.join(smokeRoot, "prod", "Output", "prod-contacts", "salesforce-report-latest.csv");

  await fs.mkdir(path.dirname(stagingContactsCsv), { recursive: true });
  await fs.mkdir(path.dirname(stagingAccountsCsv), { recursive: true });
  await fs.mkdir(path.dirname(prodContactsCsv), { recursive: true });
  await fs.mkdir(launchAgentsDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(staticDir, { recursive: true });
  await writeSmokeDataset(stagingContactsCsv, "003S00000090001", "003S00000090002");
  await writeSmokeDataset(stagingAccountsCsv, "001S00000090001", "001S00000090002");
  await writeSmokeDataset(prodContactsCsv, "003P00000090011", "003P00000090012");

  const env = {
    ...process.env,
    HOME: homeDir,
    SF_CLI_BIN: fakeSalesforceCli,
    SF_ORG_ALIAS: "smoke-org",
    SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
    PROD_SF_ORG_ALIAS: "smoke-prod",
    PROD_SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
    SF_API_VERSION: "v67.0",
    DUPLICATE_REVIEWER_STATIC_DIR: staticDir,
    DUPLICATE_REVIEWER_PROD_ROOT: path.join(smokeRoot, "prod"),
    STAGING_CONTACTS_CSV: stagingContactsCsv,
    STAGING_ACCOUNTS_CSV: stagingAccountsCsv,
    PROD_CONTACTS_CSV: prodContactsCsv
  };
  const scriptPath = path.join(PROJECT_DIR, "scripts", "start-reviewer-server.sh");

  try {
    const firstLaunch = await runShellScript(scriptPath, [], env);
    const baseUrl = firstLaunch.url;
    if (!baseUrl) {
      throw new Error(`Reviewer force-refresh regression did not return a launch URL: ${JSON.stringify(firstLaunch)}`);
    }
    const firstHealth = await requestJson(`${baseUrl}/api/health`);
    if (!firstHealth?.pid || !firstHealth.runtimeAlignedCheckedAt) {
      throw new Error(`Reviewer force-refresh regression did not expose startup health state: ${JSON.stringify(firstHealth)}`);
    }

    const secondLaunch = await runShellScript(scriptPath, ["--force-refresh"], env);
    const secondHealth = await requestJson(`${baseUrl}/api/health`);
    if (
      !secondLaunch.stdout.includes("Force-refreshing Salesforce Duplicate Reviewer server at") ||
      secondHealth.pid === firstHealth.pid ||
      secondHealth.runtimeAlignedCheckedAt <= firstHealth.runtimeAlignedCheckedAt
    ) {
      throw new Error(
        `Reviewer force-refresh regression failed: ${JSON.stringify({ firstHealth, secondHealth, secondLaunch: secondLaunch.stdout })}`
      );
    }
  } finally {
    await unloadReviewerLaunchAgent();
    await fs.rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function assertCodexTrainingLaunchCommand(baseUrl) {
  const command = buildCodexTrainingCommand({
    rootDir: "/tmp/duplicate-reviewer",
    prompt: "Read /tmp/duplicate-reviewer/Output/codex-training-request-latest.md and start fresh.",
    codexBin: "codex"
  });

  if (!command.includes("codex") || command.includes("resume") || command.includes("gpt-5.5")) {
    throw new Error(`Codex launch command still reuses an existing session or hardcodes the expensive model: ${command}`);
  }

  const legacyTargetSessionFile = path.join(PROJECT_DIR, "Output", "codex-target-session-id.txt");
  try {
    const legacyTargetSessionText = await fs.readFile(legacyTargetSessionFile, "utf8");
    const legacyTargetSessionId = legacyTargetSessionText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (legacyTargetSessionId) {
      throw new Error(
        `Legacy Codex target-session file still exists at ${legacyTargetSessionFile}: ${legacyTargetSessionId}. ` +
        "The Send to Codex button must start fresh instead of resuming an old session."
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const configuredCommand = buildCodexTrainingCommand({
    rootDir: "/tmp/duplicate-reviewer",
    prompt: "Read /tmp/duplicate-reviewer/Output/codex-training-request-latest.md and start fresh.",
    codexBin: "codex",
    model: "gpt-5.4-mini",
    reasoningEffort: "medium"
  });

  if (
    !configuredCommand.includes("--model 'gpt-5.4-mini'") ||
    !configuredCommand.includes(`model_reasoning_effort="medium"`)
  ) {
    throw new Error(`Codex launch command did not preserve explicit model overrides: ${configuredCommand}`);
  }

  const codexRequestResponse = await requestText(`${baseUrl}/api/codex/training-labels`, {
    method: "POST",
    body: {
      objectType: "contact",
      fileName: "salesforce-report-latest.json",
      datasetKey: "contact:2:latest",
      sourceDataset: {
        endpoint: "/api/staging-contacts/latest.json",
        fileName: "salesforce-report-latest.json",
        displayName: "Latest Contacts",
        objectType: "contact",
        format: "json"
      },
      rowCount: 2,
      groupCount: 1,
      labelCount: 1,
      separationCount: 0,
      requestedAction: "Use the loaded source dataset copy, not the repo root.",
      rows: [
        [
          "object_type",
          "file_name",
          "group_key",
          "group_score",
          "min_pair_score",
          "left_salesforce_id",
          "right_salesforce_id",
          "left_record_key",
          "right_record_key",
          "left_name",
          "right_name",
          "pair_score",
          "label",
          "confidence",
          "reasons",
          "field_scores_json",
          "created_at",
          "updated_at"
        ],
        [
          "contact",
          "salesforce-report-latest.json",
          "group-1",
          88,
          86,
          "003T00000000001",
          "003T00000000002",
          "003T00000000001",
          "003T00000000002",
          "Ada Lovelace",
          "Ada Lovelace",
          88,
          "match",
          "high",
          "Example",
          "[]",
          "2026-06-08T00:00:00.000Z",
          "2026-06-08T00:00:00.000Z"
        ]
      ],
      separatedRows: []
    }
  });
  if (codexRequestResponse.statusCode !== 200) {
    throw new Error(`Codex training-label endpoint failed during payload regression check: HTTP ${codexRequestResponse.statusCode}: ${codexRequestResponse.body}`);
  }
  const codexRequestPayload = JSON.parse(codexRequestResponse.body);
  const generatedRequestMarkdown = await fs.readFile(codexRequestPayload.latestRequestPath, "utf8");
  if (
    !generatedRequestMarkdown.includes("## Source Dataset") ||
    !generatedRequestMarkdown.includes("Endpoint: /api/staging-contacts/latest.json") ||
    !generatedRequestMarkdown.includes("Display name: Latest Contacts")
  ) {
    throw new Error(`Codex request markdown did not include the source dataset metadata: ${generatedRequestMarkdown}`);
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

async function runShellScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const processHandle = childProcess.spawn("/bin/zsh", [scriptPath, ...args], {
      cwd: PROJECT_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const logs = captureProcessLogs(processHandle);
    let stdout = "";
    processHandle.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    processHandle.on("error", reject);
    processHandle.on("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Reviewer launcher script failed (${code ?? signal}).\n${logs.join("\n")}`));
        return;
      }
      const url = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      resolve({ stdout, url, logs });
    });
  });
}

async function unloadReviewerLaunchAgent() {
  if (process.platform !== "darwin") return;
  const label = "com.salesforce-duplicate-reviewer.server";
  const serviceTarget = `gui/${process.getuid()}/${label}`;
  childProcess.spawnSync("/bin/launchctl", ["bootout", serviceTarget], { stdio: "ignore" });
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
    !response.body.includes('app.js?v=duplicate-reviewer-cli-warning-safe-v4')
  ) {
    throw new Error(`Static app contract failed: HTTP ${response.statusCode}`);
  }
}

async function assertTrimmedContactExportSchemaRegression() {
  const approvedContactQuery = [
    "SELECT",
    "  Id,",
    "  Name,",
    "  FirstName,",
    "  LastName,",
    "  Email,",
    "  Phone,",
    "  MobilePhone,",
    "  Account.Name,",
    "  MailingStreet,",
    "  MailingCity,",
    "  MailingState,",
    "  MailingPostalCode,",
    "  MailingCountry,",
    "  LeadSource,",
    "  CreatedDate,",
    "  ziPersonDirectPhone__c,",
    "  ZI_Person_LinkedIn_URL__c",
    "FROM Contact"
  ].join("\n");
  const contactQueryExpectations = new Map([
    [
      path.join(PROJECT_DIR, "queries", "contacts.soql.example"),
      [
        "SELECT",
        "  Id,",
        "  Name,",
        "  FirstName,",
        "  LastName,",
        "  Email,",
        "  Phone,",
        "  MobilePhone,",
        "  Account.Name,",
        "  MailingStreet,",
        "  MailingCity,",
        "  MailingState,",
        "  MailingPostalCode,",
        "  MailingCountry,",
        "  LeadSource,",
        "  CreatedDate,",
        "  ziPersonDirectPhone__c,",
        "  ZI_Person_LinkedIn_URL__c",
        "FROM Contact",
        "WHERE Name != null",
        "LIMIT 1000"
      ].join("\n")
    ],
    [
      path.join(PROJECT_DIR, "queries", "report-00OVZ000003DjaH2AS.soql"),
      approvedContactQuery
    ],
    [
      path.join(PROJECT_DIR, "queries", "report-00OVq00000CxYd3MAF.soql"),
      approvedContactQuery
    ]
  ]);
  const accountQueryPath = path.join(PROJECT_DIR, "queries", "report-00OVZ000003Dm572AC.soql");
  const accountQuery = await fs.readFile(accountQueryPath, "utf8");

  for (const [contactQueryPath, expectedContactQuery] of contactQueryExpectations.entries()) {
    const contactQuery = await fs.readFile(contactQueryPath, "utf8");
    if (normalizeQueryText(contactQuery) !== normalizeQueryText(expectedContactQuery)) {
      throw new Error(`Query schema regression failed for ${contactQueryPath}: ${JSON.stringify(contactQuery)}`);
    }
  }
  assertQueryContainsAll(accountQueryPath, accountQuery, [
    "Id",
    "Name",
    "Website",
    "Phone",
    "BillingStreet",
    "BillingCity",
    "BillingState",
    "BillingPostalCode",
    "BillingCountry",
    "CurrencyIsoCode",
    "Parent.Name",
    "Industry",
    "Ultimate_Parent_Account__c"
  ]);

  const api = loadAppApi();

  const contactHeaders = [
    "Id",
    "Name",
    "FirstName",
    "LastName",
    "Email",
    "Phone",
    "MobilePhone",
    "Account.Name",
    "MailingStreet",
    "MailingCity",
    "MailingState",
    "MailingPostalCode",
    "MailingCountry",
    "LeadSource",
    "CreatedDate",
    "ziPersonDirectPhone__c",
    "ZI_Person_LinkedIn_URL__c"
  ];
  const contactParsed = api.parseCsv([
    contactHeaders.join(","),
    "003E00000000001,Taylor Mason,Taylor,Mason,taylor.mason@example.com,555-010-1000,555-010-1001,Northstar Analytics,1 Main St,Dallas,TX,75201,United States,Web,2026-04-01T00:00:00.000+0000,555-010-1004,https://www.linkedin.com/in/taylor-mason-1010/",
    "003E00000000002,Taylor Mason,Taylor,Mason,taylor.mason@example.com,555-010-1000,555-010-1001,Northstar Analytics,9 Other St,Austin,TX,73301,United States,Web,2026-04-01T00:00:00.000+0000,555-010-1004,https://www.linkedin.com/in/taylor-mason-1010/"
  ].join("\n"));
  const contactRows = contactParsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const contactMapping = api.autoMapHeaders(contactParsed.headers, api.OBJECT_CONFIG.contact.fields);
  const contactPrepared = api.prepareRows(contactRows, "contact", contactMapping);
  if (
    contactMapping.company !== "Account.Name" ||
    contactMapping.mailingStreet !== "MailingStreet" ||
    contactMapping.mailingPostalCode !== "MailingPostalCode" ||
    contactMapping.leadSource !== "LeadSource" ||
    contactMapping.createdDate !== "CreatedDate" ||
    contactMapping.ziPhone !== "ziPersonDirectPhone__c" ||
    contactMapping.ziPersonLinkedInUrl !== "ZI_Person_LinkedIn_URL__c"
  ) {
    throw new Error(`Trimmed contact export schema auto-mapping failed: ${JSON.stringify(contactMapping)}`);
  }
  const contactAligned = api.scoreContactPair(contactPrepared[0], contactPrepared[0]);
  const contactConflict = api.scoreContactPair(contactPrepared[0], contactPrepared[1]);
  if (!(contactAligned.value > contactConflict.value) || contactConflict.fieldScores.mailingStreet == null) {
    throw new Error(
      `Contact mailing-address regression failed: aligned=${contactAligned.value}, conflict=${contactConflict.value}, fields=${JSON.stringify(contactConflict.fieldScores)}`
    );
  }

  const accountHeaders = [
    "Id",
    "Name",
    "Website",
    "Phone",
    "BillingStreet",
    "BillingCity",
    "BillingState",
    "BillingPostalCode",
    "BillingCountry",
    "CurrencyIsoCode",
    "Parent.Name",
    "Industry",
    "Type",
    "NumberOfEmployees",
    "AnnualRevenue",
    "DUNSNumber",
    "Ultimate_Parent_Account__c"
  ];
  const accountParsed = api.parseCsv([
    accountHeaders.join(","),
    "001E00000000001,Northstar Analytics,northstar.example,555-020-1000,1 Main St,Dallas,TX,75201,United States,USD,Northstar Holdings,Media,Company,45,1200000,123456789,Northstar Holdings",
    "001E00000000002,Northstar Analytics,northstar.example,555-020-1999,1 Main St,Dallas,TX,75201,United States,USD,Northstar Holdings,Media,Company,45,1200000,123456789,Northstar Holdings"
  ].join("\n"));
  const accountRows = accountParsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const accountMapping = api.autoMapHeaders(accountParsed.headers, api.OBJECT_CONFIG.account.fields);
  const accountPrepared = api.prepareRows(accountRows, "account", accountMapping);
  if (
    accountMapping.phone !== "Phone" ||
    accountMapping.ultimateParentAccount !== "Parent.Name" ||
    accountMapping.accountCurrency !== "CurrencyIsoCode"
  ) {
    throw new Error(`Account export schema upgrade auto-mapping failed: ${JSON.stringify(accountMapping)}`);
  }
  const accountAligned = api.scoreAccountPair(accountPrepared[0], accountPrepared[0], api.buildFieldStats(accountPrepared, "account"));
  const accountConflict = api.scoreAccountPair(accountPrepared[0], accountPrepared[1], api.buildFieldStats(accountPrepared, "account"));
  if (!(accountAligned.value > accountConflict.value) || accountConflict.fieldScores.phone == null) {
    throw new Error(
      `Account phone regression failed: aligned=${accountAligned.value}, conflict=${accountConflict.value}, fields=${JSON.stringify(accountConflict.fieldScores)}`
    );
  }
}

function assertQueryContainsAll(queryPath, queryText, fields) {
  const missing = fields.filter((field) => !queryText.includes(field));
  if (missing.length) {
    throw new Error(`Query schema regression failed for ${queryPath}: missing ${missing.join(", ")}`);
  }
}

function assertQueryExcludes(queryPath, queryText, fields) {
  const present = fields.filter((field) => queryText.includes(field));
  if (present.length) {
    throw new Error(`Query schema regression failed for ${queryPath}: trimmed fields still present: ${present.join(", ")}`);
  }
}

function normalizeQueryText(queryText) {
  return String(queryText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

async function assertAccountScopeDivergenceRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,Website,BillingStreet,BillingCity,BillingState,BillingPostalCode,BillingCountry,CurrencyIsoCode,Ultimate_Parent_Account__c",
    "001A,Southern Methodist University Office of the President,smu.edu,6425 Boaz St,Dallas,Texas,752750221,United States,USD,Southern Methodist University",
    "001B,Southern Methodist University,smu.edu,,,,,United States,USD,Southern Methodist University"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.account.fields);
  const preparedRows = api.prepareRows(rows, "account", mapping);

  api.state.objectType = "account";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const fieldStats = api.buildFieldStats(preparedRows, "account");
  const score = api.scoreAccountPair(preparedRows[0], preparedRows[1], fieldStats);
  if (Math.round(score.value) !== 85 || !score.reasons.includes("Different account scope")) {
    throw new Error(
      `Account scope divergence regression failed: expected exact website to cap at 85 with a scope reason, got ${Math.round(score.value)} (${score.reasons.join("; ")})`
    );
  }
}

async function assertAccountExactWebsiteCorroborationRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,BillingStreet,BillingCity,CurrencyIsoCode",
    "001C,European Service Network S.A.,1 Rue Example,Brussels,USD",
    "001D,European Service Network S.A.,1 Rue Example,Brussels,EUR"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.account.fields);
  const preparedRows = api.prepareRows(rows, "account", mapping);

  api.state.objectType = "account";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const fieldStats = api.buildFieldStats(preparedRows, "account");
  const score = api.scoreAccountPair(preparedRows[0], preparedRows[1], fieldStats);
  if (Math.round(score.value) !== 92 || !score.reasons.includes("Exact duplicate corroboration")) {
    throw new Error(
      `Account exact-billing corroboration regression failed: expected the Salesforce-calibrated floor at 92, got ${Math.round(score.value)} (${score.reasons.join("; ")})`
    );
  }
}

async function assertAccountCommentaryNormalizationRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,Phone,BillingCountry",
    "001CN1,Northstar Analytics (FKA),(555) 010-2200,United States",
    "001CN2,Northstar Analytics,(555) 010-2200,United States"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.account.fields);
  const preparedRows = api.prepareRows(rows, "account", mapping);
  const fieldStats = api.buildFieldStats(preparedRows, "account");
  const score = api.scoreAccountPair(preparedRows[0], preparedRows[1], fieldStats);

  if (
    preparedRows[0].organization !== preparedRows[1].organization ||
    preparedRows[0].organization !== "northstar analytics" ||
    score.fieldScores.name !== 1 ||
    !score.reasons.includes("Exact account name")
  ) {
    throw new Error(
      `Account commentary normalization regression failed: ${JSON.stringify({
        organizations: preparedRows.map((row) => row.organization),
        score: Math.round(score.value),
        fieldScores: score.fieldScores,
        reasons: score.reasons
      })}`
    );
  }
}

async function assertContactSparseExactNameFloorRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,First Name,Last Name,Account.Name,Email,Phone,MobilePhone,Lead Source,Created Date,ziPersonDirectPhone__c,ZI_Person_LinkedIn_URL__c",
    "003A00000000001,Taylor Mason,Taylor,Mason,,taylor.mason@alpha.example,,,,,,",
    "003A00000000002,Taylor Mason,Taylor,Mason,,taylor.mason@sample.net,,,,,,"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const score = api.scoreContactPair(preparedRows[0], preparedRows[1]);
  if (Math.round(score.value) !== 86 || !score.reasons.includes("Different company without corroborating contact data")) {
    throw new Error(
      `Contact sparse exact-name regression failed: expected the new 86-point floor, got ${Math.round(score.value)} (${score.reasons.join("; ")})`
    );
  }
}

async function assertContactMirrorProvenanceGap() {
  const metadataPath = path.join(PROJECT_DIR, "tests", "fixtures", "contact-mirror-provenance-metadata.json");
  const csvPath = path.join(PROJECT_DIR, "tests", "fixtures", "contact-mirror-provenance.csv");
  const queryPath = path.join(PROJECT_DIR, "tests", "fixtures", "contact-mirror-provenance.soql");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const csvHeaders = (await fs.readFile(csvPath, "utf8"))
    .split(/\r?\n/, 1)[0]
    .split(",")
    .map((header) => header.replace(/^"|"$/g, ""));
  const queryText = await fs.readFile(queryPath, "utf8");

  const metadataColumns = [
    ...(metadata?.reportMetadata?.detailColumns || []),
    ...Object.values(metadata?.reportExtendedMetadata?.detailColumnInfo || {}).map((column) => column?.label || "")
  ];

  for (const sourceText of [metadataColumns.join("\n"), csvHeaders.join("\n"), queryText]) {
    if (/mirror\s+of/i.test(sourceText)) {
      throw new Error(
        "The staging Contacts report contract still exposes Mirror Of in the source report or generated output. " +
        "Mirror values must come from a companion source or post-export normalization step, not from the Contact report itself."
      );
    }
  }
}

async function assertContactCompanyDifferenceVetoRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,First Name,Last Name,Account.Name,Email,Phone,MobilePhone,Lead Source,Created Date,ziPersonDirectPhone__c,ZI_Person_LinkedIn_URL__c",
    "003A00000000011,Taylor Mason,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,(555) 010-4321,,Web,2024-04-01,(555) 010-4321,https://www.linkedin.com/in/taylor-mason-1010/",
    "003A00000000012,Taylor Mason,Taylor,Mason,Civic Harbor,taylor.mason@northstar.example,(555) 010-4321,,Web,2024-04-01,(555) 010-4321,https://www.linkedin.com/in/taylor-mason-1010/"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const score = api.scoreContactPair(preparedRows[0], preparedRows[1]);
  if (Math.round(score.value) !== 79 || !score.reasons.includes("Exact contact data with conflicting company")) {
    throw new Error(
      `Contact company-veto regression failed: expected company mismatch to cap the pair below threshold without hard-zeroing it, got ${Math.round(score.value)} (${score.reasons.join("; ")})`
    );
  }

  const legacyScore = api.scoreContactPairLegacy(preparedRows[0], preparedRows[1]);
  if (Math.round(legacyScore.value) !== 0 || !legacyScore.reasons.includes("Different company")) {
    throw new Error(
      `Contact legacy comparison regression failed: expected the legacy scorer to remain a hard veto, got ${Math.round(legacyScore.value)} (${legacyScore.reasons.join("; ")})`
    );
  }
}

async function assertContactExactPhoneLinkedInDivergenceRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,First Name,Last Name,Account.Name,Email,Phone,MobilePhone,Lead Source,Created Date,ziPersonDirectPhone__c,ZI_Person_LinkedIn_URL__c",
    "003A00000000021,Michael Zehr,Michael,Zehr,Capcventures,mzehr@capcventures.com.invalid,2022106647,,Web,2024-05-01,2022106647,https://www.linkedin.com/in/michael-zehr-2670b57/",
    "003A00000000022,Michael Whatley,Michael,Whatley,Capcventures,mwhatley@capcventures.com.invalid,2022106647,,Referral,2024-05-01,2022106647,https://www.linkedin.com/in/michael-zehr-2670b57/"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const score = api.scoreContactPair(preparedRows[0], preparedRows[1]);
  if (Math.round(score.value) !== 76 || !score.reasons.includes("Exact phone and LinkedIn with divergent name")) {
    throw new Error(
      `Contact phone+LinkedIn divergence regression failed: expected the new stabilized score, got ${Math.round(score.value)} (${score.reasons.join("; ")})`
    );
  }
}

async function assertContactSharedCompanyExactPhoneNameConflictRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,First Name,Last Name,Account.Name,Email,Phone,MobilePhone,Lead Source,Created Date,ziPersonDirectPhone__c,ZI_Person_LinkedIn_URL__c",
    "003f200002O50cwAAB,Karen Irish,Karen,Irish,Out & Equal Workplace Advocates,kirish@outandequal.org.invalid,+1 415 694 6500,(202) 372-5155,Web,2024-04-01,+1 415 694 6500,https://www.linkedin.com/in/karen-irish/",
    "003f200002drJvyAAE,Caryn Viverito,Caryn,Viverito,Out & Equal Workplace Advocates,,(415) 694-6500,(202) 567-3306,Referral,2024-04-01,(415) 694-6500,https://www.linkedin.com/in/caryn-viverito/"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const score = api.scoreContactPair(preparedRows[0], preparedRows[1]);
  if (Math.round(score.value) >= 86 || !score.reasons.includes("Shared company and exact phone with conflicting names")) {
    throw new Error(
      `Contact shared-company exact-phone regression failed: expected the divergent-name pair to stay below the duplicate threshold, got ${Math.round(score.value)} (${score.reasons.join("; ")})`
    );
  }
}

async function assertContactLegacyComparisonRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,Name,First Name,Last Name,Account.Name,Email,Phone,MobilePhone,Lead Source,Created Date,ziPersonDirectPhone__c,ZI_Person_LinkedIn_URL__c",
    "003C00000000001,Abby Simmons,Abby,Simmons,Crop Life International,abby.simmons@croplife.org,+1 202 555 0199,,Web,2024-04-01,+1 202 555 0199,https://www.linkedin.com/in/abby-simmons/",
    "003C00000000002,Abby Simmons,Abby,Simmons,CropLife International,abby.simmons@croplife.org,+1 202 555 0199,,Web,2024-04-01,+1 202 555 0199,https://www.linkedin.com/in/abby-simmons/",
    "003C00000000003,Robin Quill,Robin,Quill,Civic Harbor,robin.quill@civic.example,,,,Web,2024-04-01,,"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const newScore = api.scoreContactPair(preparedRows[0], preparedRows[1]);
  const legacyScore = api.scoreContactPairLegacy(preparedRows[0], preparedRows[1]);
  if (Math.round(newScore.value) < 86 || Math.round(legacyScore.value) !== 0) {
    throw new Error(
      `Contact legacy-vs-new score regression failed: new=${Math.round(newScore.value)} legacy=${Math.round(legacyScore.value)}`
    );
  }

  const result = await api.buildGroupsAsync(rows, "contact", mapping, 86, true);
  if ("matchComparison" in result) {
    throw new Error(`Contact comparison regression failed: the runtime matcher should no longer emit legacy comparison stats, got ${JSON.stringify(result.matchComparison)}`);
  }
}

async function assertContactModelEvaluationReportRegression() {
  const report = await generateContactModelEvaluationReport({
    benchmarks: DEFAULT_BENCHMARKS.filter((benchmark) => benchmark.source === "fixture"),
    progress: async () => {}
  });

  if (!report || !Array.isArray(report.datasets) || !report.datasets.length) {
    throw new Error(`Contact model evaluation report regression failed: report generation returned no datasets`);
  }
  if (!report.analysis?.samePersonSameCompanyVariants?.pass) {
    throw new Error(`Contact model evaluation report regression failed: same-person analysis did not pass: ${JSON.stringify(report.analysis)}`);
  }
  if (!report.analysis?.differentCompanySuppression?.pass) {
    throw new Error(`Contact model evaluation report regression failed: different-company analysis did not pass: ${JSON.stringify(report.analysis)}`);
  }
  if (!report.analysis?.mirrorZeroExclusion?.pass) {
    throw new Error(`Contact model evaluation report regression failed: mirror exclusion analysis did not pass: ${JSON.stringify(report.analysis)}`);
  }
  if (!report.summary?.overallPass) {
    throw new Error(`Contact model evaluation report regression failed: overall report analysis did not pass: ${JSON.stringify(report.summary)}`);
  }
}

async function assertContactMirrorRelationshipRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,First Name,Last Name,Company,Email,Mirror of",
    "003M00000000001,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,003M00000000002",
    "003M00000000002,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,",
    "003M00000000003,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const mirrorScore = api.scoreContactPair(preparedRows[0], preparedRows[1]);
  if (mirrorScore.value !== 0 || !mirrorScore.reasons.includes("Entitled Contact mirror")) {
    throw new Error(
      `Contact mirror regression failed: expected a hard mirror veto, got ${Math.round(mirrorScore.value)} (${mirrorScore.reasons.join("; ")})`
    );
  }

  const scoreAtoC = api.scoreContactPair(preparedRows[0], preparedRows[2]);
  const scoreBtoC = api.scoreContactPair(preparedRows[1], preparedRows[2]);
  const pairScores = [scoreAtoC, scoreBtoC]
    .filter((score) => score.value >= 86)
    .sort((left, right) => right.value - left.value || right.fieldMatchRatio - left.fieldMatchRatio);
  const conflictMap = api.buildContactMirrorConflictMap(preparedRows);
  const groupsByRoot = api.collectPairGroups(pairScores, preparedRows.length, conflictMap);
  const groupMemberships = [...groupsByRoot.values()].map((group) => [...group.records.values()].map((record) => record.Id));

  if (groupMemberships.some((ids) => ids.includes("003M00000000001") && ids.includes("003M00000000002"))) {
    throw new Error(`Contact mirror clustering regression failed: mirrored contacts ended up in the same group: ${JSON.stringify(groupMemberships)}`);
  }
}

async function assertVisibleExcludedMirrorGroupRegression() {
  const api = loadAppApi();
  const csv = [
    "Id,First Name,Last Name,Company,Email,Mirror of",
    "003X00000000001,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,003X00000000002",
    "003X00000000002,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,",
    "003X00000000003,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,"
  ].join("\n");
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const result = await api.buildGroupsAsync(rows, "contact", mapping, 86, true);
  const excludedGroup = result.groups.find((group) => group.status === "excluded");
  const normalGroups = result.groups.filter((group) => group.status !== "excluded");
  const normalMemberships = normalGroups.map((group) => group.records.map((record) => record.Id));

  if (!excludedGroup) {
    throw new Error(`Visible excluded-group regression failed: expected a visible excluded mirror group, got ${JSON.stringify(result.groups)}`);
  }
  if (excludedGroup.score !== 0 || excludedGroup.minPairScore !== 0 || !excludedGroup.isMergeBlocked || excludedGroup.exclusionReason !== "Entitled Contact mirror") {
    throw new Error(`Visible excluded-group regression failed: excluded group metadata was wrong: ${JSON.stringify(excludedGroup)}`);
  }
  if (!excludedGroup.records.some((record) => record.Id === "003X00000000001") || !excludedGroup.records.some((record) => record.Id === "003X00000000002")) {
    throw new Error(`Visible excluded-group regression failed: excluded pair records were wrong: ${JSON.stringify(excludedGroup.records)}`);
  }
  if (normalMemberships.some((ids) => ids.includes("003X00000000001") && ids.includes("003X00000000002"))) {
    throw new Error(`Visible excluded-group regression failed: mirrored contacts still landed in a normal group: ${JSON.stringify(normalMemberships)}`);
  }
  if (!normalGroups.some((group) => group.records.length >= 2)) {
    throw new Error(`Visible excluded-group regression failed: expected a surviving positive duplicate group, got ${JSON.stringify(result.groups)}`);
  }
}

async function assertExcludedGroupDatasetExportRegression() {
  const api = loadAppApi();

  const excludedOnlyCsv = [
    "Id,First Name,Last Name,Company,Email,Mirror of",
    "003Y00000000001,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,003Y00000000002",
    "003Y00000000002,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,"
  ].join("\n");
  const excludedOnlyExport = await buildExportRowsForCsv(api, excludedOnlyCsv);
  const excludedOnlyScores = excludedOnlyExport.rowsById;
  ["003Y00000000001", "003Y00000000002"].forEach((id) => {
    const row = excludedOnlyScores.get(id);
    if (!row || String(row.score) !== "0" || !row.group) {
      throw new Error(`Excluded-only export regression failed for ${id}: ${JSON.stringify(row)}`);
    }
  });

  const overlapCsv = [
    "Id,First Name,Last Name,Company,Email,Mirror of",
    "003Z00000000001,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,003Z00000000002",
    "003Z00000000002,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,",
    "003Z00000000003,Taylor,Mason,Northstar Analytics,taylor.mason@northstar.example,",
    "003Z00000000004,Robin,Quill,Civic Harbor,robin.quill@civic.example,"
  ].join("\n");
  const overlapExport = await buildExportRowsForCsv(api, overlapCsv);
  ["003Z00000000001", "003Z00000000002"].forEach((id) => {
    const row = overlapExport.rowsById.get(id);
    if (!row || !row.group || String(row.score) === "0" || row.score === "") {
      throw new Error(`Excluded-overlap export regression failed for ${id}: ${JSON.stringify(row)}`);
    }
  });
  const unrelatedRow = overlapExport.rowsById.get("003Z00000000004");
  if (!unrelatedRow || unrelatedRow.group || unrelatedRow.score) {
    throw new Error(`Excluded-overlap export regression failed for unrelated row: ${JSON.stringify(unrelatedRow)}`);
  }
}

async function buildExportRowsForCsv(api, csv) {
  const parsed = api.parseCsv(csv);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);

  api.state.objectType = "contact";
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  const result = await api.buildGroupsAsync(rows, "contact", mapping, 86, true);
  api.state.groups = result.groups;
  const exportRows = api.buildScoredDatasetRows();
  const header = exportRows[0];
  const idIndex = header.indexOf("Id");
  const groupIndex = header.indexOf("group");
  const scoreIndex = header.indexOf("score");
  const rowsById = new Map(
    exportRows.slice(1).map((row) => [
      row[idIndex],
      {
        group: row[groupIndex],
        score: row[scoreIndex]
      }
    ])
  );

  return {
    exportRows,
    rowsById
  };
}

function loadAppApi() {
  const context = {
    console,
    Blob,
    URL,
    Intl,
    performance,
    setTimeout,
    clearTimeout,
    FileReader: function FileReader() {},
    indexedDB: undefined,
    document: createMockDocument()
  };
  context.globalThis = context;
  vm.createContext(context);

  const appCode = require("node:fs").readFileSync(path.join(PROJECT_DIR, "public", "app.js"), "utf8");
  vm.runInContext(
    `${appCode}
globalThis.__api = {
  OBJECT_CONFIG,
  state,
  buildGroupsAsync,
  buildScoredDatasetRows,
  parseCsv,
  inferHeaders,
  autoMapHeaders,
  prepareRows,
  buildFieldStats,
  buildContactMirrorConflictMap,
  collectPairGroups,
  scoreAccountPair,
  scoreContactPairLegacy,
  scoreContactPair,
  getValue
};`,
    context
  );
  return context.__api;
}

function createMockDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createMockElement(id));
      return elements.get(id);
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return createMockElement(tag);
    }
  };
}

function createMockElement(id) {
  return {
    id,
    hidden: false,
    value: id === "threshold" ? "86" : "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    checked: false,
    indeterminate: false,
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute() {},
    addEventListener() {},
    append() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    click() {}
  };
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
  payload.orgAlias = "qa-smoke-org";
  payload.instanceUrl = fakeSalesforceServer.baseUrl;
  const response = await requestText(`${baseUrl}/api/salesforce/premerge-check`, {
    method: "POST",
    body: payload
  });
  if (response.statusCode !== 200) {
    throw new Error(`Warning CLI pre-merge contract failed: HTTP ${response.statusCode}: ${response.body}`);
  }

  const body = JSON.parse(response.body);
  if (body.status !== "fresh" || body.orgAlias !== payload.orgAlias || body.instanceUrl !== payload.instanceUrl) {
    throw new Error(`Warning CLI pre-merge contract returned unexpected body: ${response.body}`);
  }
}

async function assertSalesforceMergeWithWarningCli(baseUrl) {
  const payload = {
    ...smokeMergePayload(),
    masterFields: { LeadSource: "Web" },
    orgAlias: "qa-smoke-org",
    instanceUrl: fakeSalesforceServer.baseUrl
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
  if (body.orgAlias !== payload.orgAlias || body.instanceUrl !== payload.instanceUrl) {
    throw new Error(`Warning CLI merge contract did not echo the selected org: ${response.body}`);
  }
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

async function runShellScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const processHandle = childProcess.spawn("/bin/zsh", [scriptPath, ...args], {
      cwd: PROJECT_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const logs = captureProcessLogs(processHandle);
    let stdout = "";
    processHandle.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    processHandle.on("error", reject);
    processHandle.on("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Reviewer launcher script failed (${code ?? signal}).\n${logs.join("\n")}`));
        return;
      }
      const url = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      resolve({ stdout, url, logs });
    });
  });
}

async function unloadReviewerLaunchAgent() {
  if (process.platform !== "darwin") return;
  const label = "com.salesforce-duplicate-reviewer.server";
  const serviceTarget = `gui/${process.getuid()}/${label}`;
  childProcess.spawnSync("/bin/launchctl", ["bootout", serviceTarget], { stdio: "ignore" });
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
    const queryJobId = "750SMOKEQUERY000";
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      requests.push({ method: request.method, path: url.pathname });

      if (request.method === "GET" && url.pathname === "/services/data/v67.0/queryAll") {
        sendFakeJson(response, { totalSize: 2, done: true, records: fakeSalesforceContactRecords() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/services/data/v67.0/jobs/query") {
        readRequestBody(request).then(() => {
          sendFakeJson(response, {
            id: queryJobId,
            operation: "query",
            object: "Contact",
            state: "UploadComplete",
            contentType: "CSV",
            apiVersion: "v67.0"
          });
        }).catch((error) => {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          response.end(error.message || "fake Salesforce bulk query read failed");
        });
        return;
      }

      if (request.method === "GET" && url.pathname === `/services/data/v67.0/jobs/query/${queryJobId}`) {
        sendFakeJson(response, {
          id: queryJobId,
          operation: "query",
          object: "Contact",
          state: "JobComplete",
          numberRecordsProcessed: 2,
          apiVersion: "v67.0"
        });
        return;
      }

      if (request.method === "GET" && url.pathname === `/services/data/v67.0/jobs/query/${queryJobId}/results`) {
        const rows = fakeSalesforceContactRecords();
        const header = "Id,Name,Email";
        const csv = [header, ...rows.map((record) => [record.Id, record.Name, record.Email].join(","))].join("\n");
        response.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "sforce-numberofrecords": String(rows.length),
          "sforce-locator": "null"
        });
        response.end(csv);
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
  const authPayload = JSON.stringify({
    status: 0,
    result: {
      accessToken: "smoke-access-token",
      instanceUrl,
      username: "smoke.user@example.com",
      alias: "smoke-org"
    }
  });
  const listPayload = JSON.stringify({
    status: 0,
    result: {
      orgs: [
        {
          alias: "smoke-org",
          username: "smoke.user@example.com",
          orgId: "00DSMOKEORG0001",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        },
        {
          alias: "smoke-alpha",
          username: "alpha@example.com",
          orgId: "00DAAAAAAAAAAAA",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        },
        {
          alias: "smoke-bravo",
          username: "bravo@example.com",
          orgId: "00DBBBBBBBBBBBB",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        },
        {
          alias: "smoke-charlie",
          username: "charlie@example.com",
          orgId: "00DCCCCCCCCCCCC",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        },
        {
          alias: "smoke-delta",
          username: "delta@example.com",
          orgId: "00DDDDDDDDDDDDD",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        },
        {
          alias: "politico-staging",
          username: "echo@example.com",
          orgId: "00DEEEEEEEEEEEE",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        },
        {
          alias: "staging",
          username: "staging@example.com",
          orgId: "00DSTAGING00001",
          instanceUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        }
      ]
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
      ...warningLines.map((line) => `echo ${line} 1>&2`),
      "if \"%1 %2\"==\"org list\" (",
      `  echo ${listPayload}`,
      "  exit /b 1",
      ")",
      `echo ${authPayload}`,
      "exit /b 1",
      ""
    ].join("\r\n"));
    return cliPath;
  }

  await fs.writeFile(cliPath, [
    "#!/bin/sh",
    ...warningLines.map((line) => `printf '%s\\n' '${line}' >&2`),
    "case \"$1 $2\" in",
    "  \"org list\")",
    `    printf '%s\\n' '${listPayload}'`,
    "    exit 1",
    "    ;;",
    "esac",
    `printf '%s\\n' '${authPayload}'`,
    "exit 1",
    ""
  ].join("\n"));
  await fs.chmod(cliPath, 0o755);
  return cliPath;
}

async function assertSalesforceOrgCatalogRoute(baseUrl) {
  const response = await requestJson(`${baseUrl}/api/salesforce/orgs`);
  const aliases = (response.orgs || []).map((org) => org.alias);
  if (response.warning) {
    throw new Error(`Expected the shared org catalog route to load without a warning: ${JSON.stringify(response)}`);
  }
  if (aliases.length !== 6) {
    throw new Error(`Expected the shared org catalog route to return all merged orgs: ${JSON.stringify(response)}`);
  }
  if (aliases.join(",") !== [...aliases].sort((a, b) => a.localeCompare(b)).join(",")) {
    throw new Error(`Expected shared org catalog entries to be sorted by alias: ${JSON.stringify(response.orgs)}`);
  }
  if (!aliases.includes("smoke-org") || !aliases.includes("politico-staging")) {
    throw new Error(`Expected the configured smoke and canonical staging orgs to be included in the shared org catalog: ${JSON.stringify(response.orgs)}`);
  }
  if (aliases.includes("staging")) {
    throw new Error(`Expected the legacy staging alias to be canonicalized away: ${JSON.stringify(response.orgs)}`);
  }
}

async function assertSalesforcePullReuseRegression() {
  const queryFile = path.join(tempDir, "salesforce-pull-reuse.soql");
  const outDir = path.join(tempDir, "salesforce-pull-reuse");
  await fs.writeFile(queryFile, "SELECT Id, Name FROM Contact");

  const env = {
    ...process.env,
    SF_CLI_BIN: fakeSalesforceCli,
    OUT_DIR: outDir,
    SF_ORG_ALIAS: "smoke-org",
    SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
    SF_API_VERSION: "v67.0",
    SF_SOQL_FILE: queryFile,
    BULK_POLL_MS: "1",
    DUPLICATE_REVIEWER_SKIP_BULK_QUERY: "1",
    LATEST_CSV_NAME: "salesforce-report-latest.csv",
    LATEST_JSON_NAME: "salesforce-report-latest.json"
  };

  const helperPath = path.join(PROJECT_DIR, "scripts", "run-salesforce-bulk-query.js");
  const first = await runNodeScriptCapture(helperPath, env, []);
  if (first.status !== 0 || !/Resolved canonical org smoke-org/.test(first.stdout)) {
    throw new Error(`Expected the Salesforce pull helper to resolve the canonical org on the first run: ${JSON.stringify(first)}`);
  }

  const second = await runNodeScriptCapture(helperPath, env, []);
  if (second.status !== 0 || !/Reusing recent Salesforce pull/.test(second.stdout)) {
    throw new Error(`Expected a repeated Salesforce pull request to reuse the cached result: ${JSON.stringify(second)}`);
  }
}

async function assertSalesforcePullAuthPreflightRegression() {
  const queryFile = path.join(tempDir, "salesforce-pull-auth-preflight.soql");
  const outDir = path.join(tempDir, "salesforce-pull-auth-preflight");
  const staleCli = await writeStaleAuthSalesforceCli(tempDir);
  await fs.writeFile(queryFile, "SELECT Id, Name FROM Contact");

  const env = {
    ...process.env,
    SF_CLI_BIN: staleCli,
    OUT_DIR: outDir,
    SF_ORG_ALIAS: "smoke-org",
    SF_INSTANCE_URL: fakeSalesforceServer.baseUrl,
    SF_API_VERSION: "v67.0",
    SF_SOQL_FILE: queryFile,
    BULK_POLL_MS: "1",
    DUPLICATE_REVIEWER_SKIP_BULK_QUERY: "1",
    LATEST_CSV_NAME: "salesforce-report-latest.csv",
    LATEST_JSON_NAME: "salesforce-report-latest.json"
  };

  const helperPath = path.join(PROJECT_DIR, "scripts", "run-salesforce-bulk-query.js");
  const result = await runNodeScriptCapture(helperPath, env, []);
  if (result.status === 0) {
    throw new Error(`Expected stale Salesforce auth to fail before bulk query execution: ${JSON.stringify(result)}`);
  }
  if (!/show-access-token|authentication|stale auth/i.test(result.stderr + result.stdout)) {
    throw new Error(`Expected the stale auth failure to come from the auth preflight: ${JSON.stringify(result)}`);
  }
  if (fsSync.existsSync(path.join(outDir, "salesforce-report-latest.csv")) || fsSync.existsSync(path.join(outDir, "salesforce-report-latest.json"))) {
    throw new Error(`Expected stale auth preflight to stop before writing pull outputs: ${outDir}`);
  }
}

async function assertLauncherRuntimeAlignmentRegression() {
  const launchLocal = await fs.readFile(path.join(PROJECT_DIR, "scripts", "launch-local-app.js"), "utf8");
  const startServer = await fs.readFile(path.join(PROJECT_DIR, "scripts", "start-reviewer-server.sh"), "utf8");
  if (!launchLocal.includes("runtimeAligned") || !startServer.includes('"runtimeAligned":true')) {
    throw new Error("Expected launcher/runtime checks to require runtime alignment before reusing a visible server.");
  }
}

function runNodeScriptCapture(scriptPath, env, args) {
  return new Promise((resolve) => {
    const result = childProcess.spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: PROJECT_DIR,
      env,
      encoding: "utf8"
    });
    resolve({
      status: result.status ?? 0,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || "")
    });
  });
}

async function writeStaleAuthSalesforceCli(directory) {
  const listPayload = JSON.stringify({
    result: {
      nonScratchOrgs: [
        {
          alias: "smoke-org",
          username: "smoke@example.com",
          orgId: "00DSMOKE0000001",
          instanceUrl: fakeSalesforceServer.baseUrl,
          loginUrl: "https://login.salesforce.com",
          connectedStatus: "Connected"
        }
      ]
    }
  });
  const authPayload = JSON.stringify({
    result: {
      alias: "smoke-org",
      instanceUrl: fakeSalesforceServer.baseUrl,
      accessToken: "00DSTALE"
    }
  });
  const cliPath = path.join(directory, process.platform === "win32" ? "sf-stale.cmd" : "sf-stale");
  const scriptLines = process.platform === "win32"
    ? [
        "@echo off",
        "if \"%1 %2 %3\"==\"org list --json\" (",
        `  echo ${listPayload}`,
        "  exit /b 0",
        ")",
        "if \"%1 %2 %3 %4 %5\"==\"org display --target-org smoke-org --json\" (",
        `  echo ${authPayload}`,
        "  exit /b 0",
        ")",
        "if \"%1 %2 %3 %4 %5 %6\"==\"org auth show-access-token --target-org smoke-org --json\" (",
        "  echo stale auth 1>&2",
        "  exit /b 1",
        ")",
        "echo stale auth 1>&2",
        "exit /b 1",
        ""
      ]
    : [
        "#!/bin/sh",
        "case \"$1 $2 $3\" in",
        "  \"org list --json\")",
        `    printf '%s\\n' '${listPayload}'`,
        "    exit 0",
        "    ;;",
        "esac",
        "case \"$1 $2 $3 $4 $5\" in",
        "  \"org display --target-org smoke-org --json\")",
        `    printf '%s\\n' '${authPayload}'`,
        "    exit 0",
        "    ;;",
        "esac",
        "case \"$1 $2 $3 $4 $5 $6\" in",
        "  \"org auth show-access-token --target-org smoke-org --json\")",
        "    printf '%s\\n' 'stale auth' >&2",
        "    exit 1",
        "    ;;",
        "esac",
        "printf '%s\\n' 'stale auth' >&2",
        "exit 1",
        ""
      ];
  await fs.writeFile(cliPath, scriptLines.join(process.platform === "win32" ? "\r\n" : "\n"));
  if (process.platform !== "win32") await fs.chmod(cliPath, 0o755);
  return cliPath;
}

function canonicalSalesforceOrgAlias(alias, instanceUrl = "") {
  const text = String(alias || "").trim();
  if (text.toLowerCase() !== "staging") return text;
  return String(instanceUrl || "").includes("politico--staging.sandbox.my.salesforce.com") ? "politico-staging" : text;
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
