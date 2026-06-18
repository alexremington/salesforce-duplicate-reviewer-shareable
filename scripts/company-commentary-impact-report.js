#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_DIR = path.resolve(__dirname, "..");
const PUBLIC_APP_PATH = path.join(PROJECT_DIR, "public", "app.js");
const ONEDRIVE_POLITICO_DIR = ["OneDrive", "POLITICO"].join("-");
const DEFAULT_SOURCE_PATH = path.join(
  os.homedir(),
  "Library",
  "CloudStorage",
  ONEDRIVE_POLITICO_DIR,
  "Automation Projects",
  "Salesforce Pulls",
  "Duplicate Reviewer",
  "prod",
  "Output",
  "prod-accounts",
  "salesforce-report-latest.csv"
);
const DEFAULT_OUT_DIR = path.join(PROJECT_DIR, "Output", "company-commentary-impact");
const DEFAULT_LIMIT = 5000;
const USAGE = "Usage: node scripts/company-commentary-impact-report.js [--source <accounts.csv>] [--limit <rows>] [--out-dir <dir>] [--quiet]";

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await generateCompanyCommentaryImpactReport({
    sourcePath: args.sourcePath,
    limit: args.limit,
    quiet: args.quiet
  });
  const outputs = await writeCompanyCommentaryImpactReport(report, { outDir: args.outDir });
  console.log(`Wrote company commentary impact report to ${outputs.jsonPath}`);
  console.log(`Wrote company commentary impact summary to ${outputs.markdownPath}`);
  console.log(
    JSON.stringify(
      {
        sourcePath: report.sourcePath,
        evaluatedRows: report.summary.evaluatedRows,
        changedRows: report.summary.changedRows,
        changedPercent: report.summary.changedPercent,
        uniqueTransitions: report.summary.uniqueTransitions
      },
      null,
      2
    )
  );
}

function parseArgs(args) {
  const parsed = {
    sourcePath: DEFAULT_SOURCE_PATH,
    outDir: DEFAULT_OUT_DIR,
    limit: DEFAULT_LIMIT,
    quiet: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source") {
      parsed.sourcePath = requiredValue(args, ++index, arg);
    } else if (arg === "--out-dir") {
      parsed.outDir = requiredValue(args, ++index, arg);
    } else if (arg === "--limit") {
      parsed.limit = Number(requiredValue(args, ++index, arg));
      if (!Number.isInteger(parsed.limit) || parsed.limit <= 0) {
        throw new Error(`${USAGE}\nInvalid --limit value: ${parsed.limit}`);
      }
    } else if (arg === "--quiet") {
      parsed.quiet = true;
    } else {
      throw new Error(`${USAGE}\nUnknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`${USAGE}\nMissing value for ${flag}`);
  return value;
}

async function generateCompanyCommentaryImpactReport(options = {}) {
  const api = await loadAppApi();
  const sourcePath = options.sourcePath || DEFAULT_SOURCE_PATH;
  const limit = options.limit || DEFAULT_LIMIT;
  const csvText = await fs.readFile(sourcePath, "utf8");
  const parsed = api.parseCsv(csvText);
  const rows = parsed.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = parsed.headers.length ? parsed.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.account.fields);
  const examinedRows = rows.filter((row) => api.getValue(row, mapping.name)).slice(0, limit);
  const transitions = new Map();
  const changedExamples = [];
  const unchangedExamples = [];
  let changedRows = 0;

  examinedRows.forEach((row) => {
    const rawName = api.getValue(row, mapping.name);
    const legacyKey = legacyCanonicalCompanyKey(api, rawName);
    const currentKey = api.resolveCanonicalCompanyKey(rawName);
    const changed = legacyKey !== currentKey;
    const record = {
      rowIndex: row.__rowIndex,
      id: api.getValue(row, mapping.recordId) || "",
      rawName,
      legacyKey,
      currentKey
    };

    if (changed) {
      changedRows += 1;
      const transitionKey = `${legacyKey}=>${currentKey}`;
      transitions.set(transitionKey, {
        legacyKey,
        currentKey,
        count: (transitions.get(transitionKey)?.count || 0) + 1
      });
      if (changedExamples.length < 25) changedExamples.push(record);
    } else if (unchangedExamples.length < 10) {
      unchangedExamples.push(record);
    }
  });

  const transitionList = [...transitions.values()].sort((left, right) => right.count - left.count || left.legacyKey.localeCompare(right.legacyKey));
  const evaluatedRows = examinedRows.length;
  return {
    generatedAt: new Date().toISOString(),
    sourcePath,
    sourceLimit: limit,
    summary: {
      evaluatedRows,
      changedRows,
      unchangedRows: evaluatedRows - changedRows,
      changedPercent: evaluatedRows ? Number(((changedRows / evaluatedRows) * 100).toFixed(2)) : 0,
      uniqueTransitions: transitionList.length
    },
    topTransitions: transitionList.slice(0, 20),
    changedExamples,
    unchangedExamples
  };
}

function legacyCanonicalCompanyKey(api, value) {
  const normalized = legacyNormalizeCompany(api, value);
  if (!normalized) return "";
  return api.CONTACT_ORGANIZATION_ALIASES.get(normalized) || normalized;
}

function legacyNormalizeCompany(api, value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(do not use|donotuse|inactive|obsolete|deprecated|duplicate|dupe)\b/g, " ")
    .replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|llp|lp|the)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

async function writeCompanyCommentaryImpactReport(report, options = {}) {
  const outDir = options.outDir || DEFAULT_OUT_DIR;
  await fs.mkdir(outDir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `company-commentary-impact-${timestamp}.json`);
  const markdownPath = path.join(outDir, `company-commentary-impact-${timestamp}.md`);
  const latestJsonPath = path.join(outDir, "company-commentary-impact-latest.json");
  const latestMarkdownPath = path.join(outDir, "company-commentary-impact-latest.md");
  const markdown = formatCompanyCommentaryImpactReport(report);

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, `${markdown}\n`);
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(latestMarkdownPath, `${markdown}\n`);

  return {
    jsonPath,
    markdownPath,
    latestJsonPath,
    latestMarkdownPath
  };
}

function formatCompanyCommentaryImpactReport(report) {
  const lines = [];
  lines.push("# Company Commentary Impact Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source CSV: ${report.sourcePath}`);
  lines.push(`Evaluated rows: ${report.summary.evaluatedRows}`);
  lines.push(`Changed rows: ${report.summary.changedRows} (${report.summary.changedPercent}%)`);
  lines.push(`Unique transitions: ${report.summary.uniqueTransitions}`);
  lines.push("");
  lines.push("## Top transitions");
  lines.push("");
  if (!report.topTransitions.length) {
    lines.push("- No company canonical keys changed in the evaluated subset.");
  } else {
    report.topTransitions.forEach((transition) => {
      lines.push(`- ${transition.count}x: \`${transition.legacyKey}\` -> \`${transition.currentKey}\``);
    });
  }
  lines.push("");
  lines.push("## Changed examples");
  lines.push("");
  if (!report.changedExamples.length) {
    lines.push("- None");
  } else {
    report.changedExamples.forEach((example) => {
      lines.push(`- row ${example.rowIndex + 1}${example.id ? ` (${example.id})` : ""}: \`${example.rawName}\` -> legacy \`${example.legacyKey}\`, current \`${example.currentKey}\``);
    });
  }
  return lines.join("\n");
}

function loadAppApi() {
  const context = {
    console,
    Blob,
    URL,
    Intl,
    FileReader: function FileReader() {},
    indexedDB: undefined,
    document: createMockDocument()
  };
  context.globalThis = context;
  vm.createContext(context);

  return fs.readFile(PUBLIC_APP_PATH, "utf8").then((appCode) => {
    vm.runInContext(
      `${appCode}
globalThis.__api = {
  OBJECT_CONFIG,
  CONTACT_ORGANIZATION_ALIASES,
  parseCsv,
  inferHeaders,
  autoMapHeaders,
  getValue,
  resolveCanonicalCompanyKey
};`,
      context
    );
    return context.__api;
  });
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
