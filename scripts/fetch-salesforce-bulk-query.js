#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_INSTANCE_URL = "https://politico.my.salesforce.com";
const DEFAULT_API_VERSION = "v64.0";
const DEFAULT_POLL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 100000;

const USAGE = `Usage:
  SF_ACCESS_TOKEN=<token> node scripts/fetch-salesforce-bulk-query.js --query-file <query.soql> --out <output.csv> [options]
  SF_ACCESS_TOKEN=<token> node scripts/fetch-salesforce-bulk-query.js --query "SELECT Id FROM Contact" --out <output.csv> [options]

Options:
  --instance <url>       Salesforce instance URL. Default: ${DEFAULT_INSTANCE_URL}
  --query <soql>         SOQL query to run with Bulk API 2.0.
  --query-file <path>    File containing the SOQL query.
  --out <path>           Output CSV path. Required.
  --api-version <vXX.X>  Salesforce REST API version. Default: ${DEFAULT_API_VERSION}
  --query-all            Include deleted and archived records where supported.
  --poll-ms <ms>         Poll interval. Default: ${DEFAULT_POLL_MS}
  --timeout-ms <ms>      Job timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --max-records <n>      Result page size. Default: ${DEFAULT_MAX_RECORDS}
  --help                 Show this help.
`;

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const accessToken = process.env.SF_ACCESS_TOKEN;
  if (!accessToken) throw new Error(`Missing SF_ACCESS_TOKEN.\n\n${USAGE}`);
  if (!args.out) throw new Error(`Missing --out.\n\n${USAGE}`);

  const query = await readQuery(args);
  const instanceUrl = normalizeInstanceUrl(args.instance || process.env.SF_INSTANCE_URL || DEFAULT_INSTANCE_URL);
  const apiVersion = args.apiVersion || DEFAULT_API_VERSION;
  const operation = args.queryAll ? "queryAll" : "query";
  const pollMs = Number(args.pollMs || DEFAULT_POLL_MS);
  const timeoutMs = Number(args.timeoutMs || DEFAULT_TIMEOUT_MS);
  const maxRecords = Number(args.maxRecords || DEFAULT_MAX_RECORDS);

  const job = await createQueryJob({ instanceUrl, apiVersion, accessToken, query, operation });
  console.error(`Created Bulk API query job ${job.id}`);

  const completedJob = await waitForJob({ instanceUrl, apiVersion, accessToken, jobId: job.id, pollMs, timeoutMs });
  console.error(`Bulk API query job ${completedJob.id} completed with ${completedJob.numberRecordsProcessed || 0} records processed`);

  const writtenRows = await downloadResults({
    instanceUrl,
    apiVersion,
    accessToken,
    jobId: job.id,
    outputPath: args.out,
    maxRecords
  });
  console.log(`Saved ${writtenRows} result rows to ${args.out}`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--instance") {
      parsed.instance = requiredValue(args, ++index, arg);
    } else if (arg === "--query") {
      parsed.query = requiredValue(args, ++index, arg);
    } else if (arg === "--query-file") {
      parsed.queryFile = requiredValue(args, ++index, arg);
    } else if (arg === "--out") {
      parsed.out = requiredValue(args, ++index, arg);
    } else if (arg === "--api-version") {
      parsed.apiVersion = requiredValue(args, ++index, arg);
    } else if (arg === "--query-all") {
      parsed.queryAll = true;
    } else if (arg === "--poll-ms") {
      parsed.pollMs = requiredValue(args, ++index, arg);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = requiredValue(args, ++index, arg);
    } else if (arg === "--max-records") {
      parsed.maxRecords = requiredValue(args, ++index, arg);
    } else {
      throw new Error(`${USAGE}\nUnknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

async function readQuery(args) {
  if (args.query && args.queryFile) throw new Error("Use --query or --query-file, not both.");
  if (args.query) return normalizeSoql(args.query);
  if (args.queryFile) return normalizeSoql(await fs.readFile(args.queryFile, "utf8"));
  throw new Error(`Missing --query or --query-file.\n\n${USAGE}`);
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

function normalizeInstanceUrl(value) {
  const url = new URL(value);
  if (url.hostname.endsWith(".lightning.force.com")) {
    url.hostname = url.hostname.replace(".lightning.force.com", ".my.salesforce.com");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function createQueryJob({ instanceUrl, apiVersion, accessToken, query, operation }) {
  const response = await fetch(`${instanceUrl}/services/data/${apiVersion}/jobs/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operation,
      query,
      contentType: "CSV",
      columnDelimiter: "COMMA",
      lineEnding: "LF"
    })
  });
  return parseJsonResponse(response);
}

async function waitForJob({ instanceUrl, apiVersion, accessToken, jobId, pollMs, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const job = await getQueryJob({ instanceUrl, apiVersion, accessToken, jobId });
    if (job.state === "JobComplete") return job;
    if (["Aborted", "Failed"].includes(job.state)) {
      throw new Error(`Bulk API query job ${jobId} ended in ${job.state}: ${job.errorMessage || "no error message"}`);
    }
    console.error(`Waiting for Bulk API query job ${jobId}: ${job.state}`);
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for Bulk API query job ${jobId}`);
}

async function getQueryJob({ instanceUrl, apiVersion, accessToken, jobId }) {
  const response = await fetch(`${instanceUrl}/services/data/${apiVersion}/jobs/query/${jobId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  return parseJsonResponse(response);
}

async function downloadResults({ instanceUrl, apiVersion, accessToken, jobId, outputPath, maxRecords }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, "");

  let locator = "";
  let firstPage = true;
  let writtenRows = 0;

  while (locator !== "null") {
    const url = new URL(`${instanceUrl}/services/data/${apiVersion}/jobs/query/${jobId}/results`);
    url.searchParams.set("maxRecords", String(maxRecords));
    if (locator) url.searchParams.set("locator", locator);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/csv"
      }
    });
    await assertOk(response);

    const text = await response.text();
    const chunk = firstPage ? text : stripCsvHeader(text);
    if (chunk) await fs.appendFile(outputPath, ensureTrailingNewline(chunk));

    writtenRows += Number(response.headers.get("sforce-numberofrecords") || 0);
    locator = response.headers.get("sforce-locator") || "null";
    firstPage = false;
  }

  return writtenRows;
}

function stripCsvHeader(text) {
  const newlineIndex = text.indexOf("\n");
  if (newlineIndex < 0) return "";
  return text.slice(newlineIndex + 1);
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function parseJsonResponse(response) {
  await assertOk(response);
  return response.json();
}

async function assertOk(response) {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(`Salesforce request failed: ${response.status} ${response.statusText}\n${text}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
