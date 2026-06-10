#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_INSTANCE_URL = "https://your-domain.my.salesforce.com";
const DEFAULT_REPORT_ID = "contacts";
const DEFAULT_API_VERSION = "v64.0";

const USAGE = `Usage:
  SF_ACCESS_TOKEN=<token> node scripts/fetch-salesforce-report-metadata.js [options]

Options:
  --instance <url>       Salesforce instance URL. Default: ${DEFAULT_INSTANCE_URL}
  --report <id>          Salesforce report ID. Default: ${DEFAULT_REPORT_ID}
  --out <path>           Output path. Default: incoming/<reportId>-metadata.json
  --api-version <vXX.X>  Salesforce REST API version. Default: ${DEFAULT_API_VERSION}
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

  const instanceUrl = normalizeInstanceUrl(args.instance || process.env.SF_INSTANCE_URL || DEFAULT_INSTANCE_URL);
  const reportId = args.report || DEFAULT_REPORT_ID;
  const apiVersion = args.apiVersion || DEFAULT_API_VERSION;
  const outputPath = args.out || path.join("incoming", `${reportId}-metadata.json`);

  const metadata = await fetchReportMetadata({ instanceUrl, apiVersion, reportId, accessToken });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Saved report metadata to ${outputPath}`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--instance") {
      parsed.instance = requiredValue(args, ++index, arg);
    } else if (arg === "--report") {
      parsed.report = requiredValue(args, ++index, arg);
    } else if (arg === "--out") {
      parsed.out = requiredValue(args, ++index, arg);
    } else if (arg === "--api-version") {
      parsed.apiVersion = requiredValue(args, ++index, arg);
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

async function fetchReportMetadata({ instanceUrl, apiVersion, reportId, accessToken }) {
  const url = new URL(`${instanceUrl}/services/data/${apiVersion}/analytics/reports/${reportId}`);
  url.searchParams.set("includeDetails", "false");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (response.ok) return response.json();
  const text = await response.text();
  throw new Error(`Salesforce request failed: ${response.status} ${response.statusText}\n${text}`);
}
