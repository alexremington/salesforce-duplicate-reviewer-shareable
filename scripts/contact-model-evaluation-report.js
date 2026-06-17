#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {
  accountSmokeCsv,
  contactDifferentCompanyConflictSmokeCsv,
  contactLastNameChangeSmokeCsv,
  contactMirrorRelationshipSmokeCsv,
  contactSmokeCsv,
  contactSharedCompanyExactPhoneNameConflictSmokeCsv
} = require("../tests/fixtures/duplicate-reviewer-workflows");

const PROJECT_DIR = path.resolve(__dirname, "..");
const PUBLIC_APP_PATH = path.join(PROJECT_DIR, "public", "app.js");
const DEFAULT_PROD_JSON_PATH = path.join(
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
  "salesforce-report-latest.json"
);
const DEFAULT_OUT_DIR = path.join(PROJECT_DIR, "Output", "contact-model-evaluation");
const CONTACT_COMPARISON_THRESHOLD = 70;
const CONTACT_MATCH_THRESHOLD = 86;

const DEFAULT_BENCHMARKS = [
  {
    key: "contact-smoke",
    label: "Contact smoke fixture",
    source: "fixture",
    format: "csv",
    loader: contactSmokeCsv,
    includePairEvidence: true,
    aim: "same-person"
  },
  {
    key: "contact-last-name-change",
    label: "Last name change fixture",
    source: "fixture",
    format: "csv",
    loader: contactLastNameChangeSmokeCsv,
    includePairEvidence: true,
    aim: "same-person"
  },
  {
    key: "contact-different-company-conflict",
    label: "Different company conflict fixture",
    source: "fixture",
    format: "csv",
    loader: contactDifferentCompanyConflictSmokeCsv,
    includePairEvidence: true,
    aim: "different-company"
  },
  {
    key: "contact-shared-company-phone-name-conflict",
    label: "Shared company exact phone/name conflict fixture",
    source: "fixture",
    format: "csv",
    loader: contactSharedCompanyExactPhoneNameConflictSmokeCsv,
    includePairEvidence: true,
    aim: "different-company"
  },
  {
    key: "contact-mirror-relationship",
    label: "Mirror relationship fixture",
    source: "fixture",
    format: "csv",
    loader: contactMirrorRelationshipSmokeCsv,
    includePairEvidence: true,
    aim: "mirror"
  },
  {
    key: "contact-prod-latest",
    label: "Production contacts latest JSON",
    source: "prod",
    format: "json",
    filePath: DEFAULT_PROD_JSON_PATH,
    includePairEvidence: false,
    aim: "coverage"
  }
];

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await generateContactModelEvaluationReport({
    prodJsonPath: args.prodJsonPath,
    benchmarks: args.includeProd === false
      ? DEFAULT_BENCHMARKS.filter((benchmark) => benchmark.source !== "prod")
      : DEFAULT_BENCHMARKS,
    progress: (message) => {
      if (args.quiet) return;
      if (message) console.log(message);
    }
  });
  const { jsonPath, markdownPath } = await writeContactModelEvaluationReport(report, {
    outDir: args.outDir,
    writeLatest: true
  });

  console.log(`Wrote evaluation report to ${jsonPath}`);
  console.log(`Wrote evaluation summary to ${markdownPath}`);
  console.log(`Recommendation: ${report.summary.recommendation}`);
}

async function generateContactModelEvaluationReport(options = {}) {
  const api = loadAppApi();
  const benchmarks = Array.isArray(options.benchmarks) && options.benchmarks.length ? options.benchmarks : DEFAULT_BENCHMARKS;
  const prodJsonPath = options.prodJsonPath || DEFAULT_PROD_JSON_PATH;
  const progress = typeof options.progress === "function" ? options.progress : async () => {};
  const datasets = [];

  await progress("Loading benchmark datasets.");
  for (const benchmark of benchmarks) {
    const dataset = await evaluateBenchmark(api, benchmark, { prodJsonPath, progress });
    datasets.push(dataset);
  }

  const analysis = analyzeCoreAims(datasets);
  return {
    generatedAt: new Date().toISOString(),
    comparisonThreshold: CONTACT_COMPARISON_THRESHOLD,
    matchThreshold: CONTACT_MATCH_THRESHOLD,
    prodJsonPath,
    datasets,
    analysis,
    summary: {
      recommendation: analysis.overallPass
        ? "New model can supersede legacy"
        : "Hold legacy model and investigate the red flags",
      overallPass: analysis.overallPass
    }
  };
}

async function evaluateBenchmark(api, benchmark, { prodJsonPath, progress = async () => {} } = {}) {
  const loadedDataset = await loadBenchmarkDataset(api, benchmark, { prodJsonPath });
  const rows = loadedDataset.rows.map((row, index) => ({ ...row, __rowIndex: index }));
  const headers = loadedDataset.headers.length ? loadedDataset.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG.contact.fields);
  const preparedRows = api.prepareRows(rows, "contact", mapping);

  await progress(`Scoring ${benchmark.label}.`);
  const comparison = await compareContactModels(api, preparedRows, rows.length, progress);
  const pairEvidence = benchmark.includePairEvidence
    ? buildPairEvidence(api, preparedRows, rows, comparison.details, benchmark)
    : [];
  const analysis = classifyBenchmark(benchmark, comparison.summary, pairEvidence);

  return {
    key: benchmark.key,
    label: benchmark.label,
    source: benchmark.source,
    format: loadedDataset.format,
    fileName: loadedDataset.fileName,
    rowCount: rows.length,
    comparisonThreshold: CONTACT_COMPARISON_THRESHOLD,
    threshold: CONTACT_COMPARISON_THRESHOLD,
    comparison: comparison.summary,
    pairEvidence,
    analysis
  };
}

function classifyBenchmark(benchmark, comparison, pairEvidence) {
  const strongestNewPair = pairEvidence[0] || null;
  const strongestLegacyPair = [...pairEvidence].sort((left, right) => right.legacyScore.value - left.legacyScore.value)[0] || null;
  const mirrorPair = pairEvidence.find((pair) => pair.newScore.value === 0 && pair.newScore.reasons.includes("Entitled Contact mirror")) || null;

  const checks = {
    samePerson: benchmark.aim === "same-person"
      ? Boolean(strongestNewPair && strongestNewPair.newScore.value >= CONTACT_MATCH_THRESHOLD && strongestLegacyPair && strongestLegacyPair.legacyScore.value >= CONTACT_MATCH_THRESHOLD)
      : null,
    differentCompany: benchmark.aim === "different-company"
      ? Boolean(strongestNewPair && strongestNewPair.newScore.value < CONTACT_MATCH_THRESHOLD)
      : null,
    mirror: benchmark.aim === "mirror"
      ? Boolean(mirrorPair)
      : null,
    coverage: benchmark.aim === "coverage"
      ? comparison.newGroupCount >= comparison.legacyGroupCount
      : null
  };

  return {
    checks,
    pass:
      Object.values(checks)
        .filter((value) => value !== null)
        .every(Boolean) &&
      !comparison.redFlagged &&
      comparison.newGroupCount >= comparison.legacyGroupCount
  };
}

function analyzeCoreAims(datasets) {
  const fixtureDatasets = datasets.filter((dataset) => dataset.source === "fixture");
  const prodDataset = datasets.find((dataset) => dataset.source === "prod") || null;
  const samePersonDatasets = fixtureDatasets.filter((dataset) => dataset.analysis.checks.samePerson !== null);
  const differentCompanyDatasets = fixtureDatasets.filter((dataset) => dataset.analysis.checks.differentCompany !== null);
  const mirrorDatasets = fixtureDatasets.filter((dataset) => dataset.analysis.checks.mirror !== null);

  const samePersonPass = samePersonDatasets.length > 0 && samePersonDatasets.every((dataset) => dataset.analysis.checks.samePerson === true);
  const differentCompanyPass = differentCompanyDatasets.length > 0 && differentCompanyDatasets.every((dataset) => dataset.analysis.checks.differentCompany === true);
  const mirrorPass = mirrorDatasets.length > 0 && mirrorDatasets.every((dataset) => dataset.analysis.checks.mirror === true);
  const prodCoveragePass = !prodDataset || prodDataset.analysis.checks.coverage === true;
  const prodRedFlag = Boolean(prodDataset?.comparison?.redFlagged);
  const overallPass = samePersonPass && differentCompanyPass && mirrorPass && prodCoveragePass && !prodRedFlag;

  return {
    samePersonSameCompanyVariants: {
      pass: samePersonPass,
      datasets: samePersonDatasets.map((dataset) => summarizeDataset(dataset))
    },
    differentCompanySuppression: {
      pass: differentCompanyPass,
      datasets: differentCompanyDatasets.map((dataset) => summarizeDataset(dataset))
    },
    mirrorZeroExclusion: {
      pass: mirrorPass,
      datasets: mirrorDatasets.map((dataset) => summarizeDataset(dataset))
    },
    prodCoveragePreserved: {
      pass: prodCoveragePass,
      dataset: prodDataset ? summarizeDataset(prodDataset) : null
    },
    overallPass
  };
}

function summarizeDataset(dataset) {
  return {
    key: dataset.key,
    label: dataset.label,
    rowCount: dataset.rowCount,
    legacyGroupCount: dataset.comparison?.legacyGroupCount || 0,
    newGroupCount: dataset.comparison?.newGroupCount || 0,
    deltaGroupCount: dataset.comparison?.deltaGroupCount || 0,
    redFlagged: Boolean(dataset.comparison?.redFlagged),
    strongestPairs: dataset.pairEvidence.slice(0, 3).map((pair) => ({
      left: pair.leftLabel,
      right: pair.rightLabel,
      newScore: pair.newScore.value,
      legacyScore: pair.legacyScore.value,
      newReasons: pair.newScore.reasons,
      legacyReasons: pair.legacyScore.reasons
    }))
  };
}

async function loadBenchmarkDataset(api, benchmark, { prodJsonPath }) {
  if (benchmark.source === "fixture") {
    return parseCsvBenchmark(api, benchmark.loader(), benchmark.label);
  }

  const filePath = benchmark.filePath || prodJsonPath || DEFAULT_PROD_JSON_PATH;
  const text = await fs.readFile(filePath, "utf8");
  const dataset = api.parseDatasetText(text, {
    format: "json",
    fileName: path.basename(filePath),
    objectType: "contact"
  });
  return {
    ...dataset,
    filePath
  };
}

function parseCsvBenchmark(api, csvText, label) {
  const dataset = api.parseDatasetText(csvText, {
    format: "csv",
    fileName: `${label}.csv`,
    objectType: "contact"
  });
  return dataset;
}

async function compareContactModels(api, preparedRows, rowCount, progress = async () => {}) {
  const scorer = api.createPairScorer("contact");
  const legacyScorer = api.createLegacyPairScorer("contact");
  const pairKeys = await api.getContactCandidatePairsAsync(preparedRows, true, undefined, CONTACT_COMPARISON_THRESHOLD, progress);
  const newPairs = await api.scoreCandidatePairsAsync(pairKeys, preparedRows, scorer, CONTACT_COMPARISON_THRESHOLD, async () => {});
  const legacyPairs = await api.scoreCandidatePairsAsync(pairKeys, preparedRows, legacyScorer, CONTACT_COMPARISON_THRESHOLD, async () => {});
  const mirrorConflicts = api.buildContactMirrorConflictMap(preparedRows);
  const newGroups = [...api.collectPairGroups(newPairs, rowCount, mirrorConflicts).values()]
    .map((group) => api.summarizeGroup(group, preparedRows, scorer))
    .filter((group) => group.score >= CONTACT_COMPARISON_THRESHOLD);
  const legacyGroups = [...api.collectPairGroups(legacyPairs, rowCount, mirrorConflicts).values()]
    .map((group) => api.summarizeGroup(group, preparedRows, legacyScorer))
    .filter((group) => group.score >= CONTACT_COMPARISON_THRESHOLD);

  return {
    summary: {
      threshold: CONTACT_COMPARISON_THRESHOLD,
      legacyPairCount: legacyPairs.length,
      newPairCount: newPairs.length,
      deltaPairCount: newPairs.length - legacyPairs.length,
      legacyGroupCount: legacyGroups.length,
      newGroupCount: newGroups.length,
      deltaGroupCount: newGroups.length - legacyGroups.length,
      lostGroupCount: legacyGroups.filter((group) => !newGroups.some((candidate) => candidate.key === group.key)).length,
      gainedGroupCount: newGroups.filter((group) => !legacyGroups.some((candidate) => candidate.key === group.key)).length,
      redFlagged: newGroups.length < legacyGroups.length
    },
    details: {
      newPairs,
      legacyPairs,
      newGroups,
      legacyGroups
    }
  };
}

function buildPairEvidence(api, preparedRows, rows, comparison, benchmark) {
  const pairEvidence = [];
  const scoredPairs = new Map();
  [...comparison.newPairs, ...comparison.legacyPairs].forEach((pair) => {
    const leftIndex = Number(pair.left?.__rowIndex);
    const rightIndex = Number(pair.right?.__rowIndex);
    const key = pairKey(leftIndex, rightIndex);
    if (!scoredPairs.has(key)) scoredPairs.set(key, pair);
  });

  scoredPairs.forEach((pair) => {
    const leftIndex = Number(pair.left?.__rowIndex);
    const rightIndex = Number(pair.right?.__rowIndex);
    const left = preparedRows[leftIndex];
    const right = preparedRows[rightIndex];
    if (!left || !right) return;
    const key = pairKey(leftIndex, rightIndex);
    pairEvidence.push({
      leftIndex,
      rightIndex,
      leftLabel: describeRow(rows[leftIndex]),
      rightLabel: describeRow(rows[rightIndex]),
      leftSalesforceId: rowSalesforceId(rows[leftIndex]),
      rightSalesforceId: rowSalesforceId(rows[rightIndex]),
      newScore: {
        value: Math.round((comparison.newPairs.find((candidate) => pairKey(Number(candidate.left?.__rowIndex), Number(candidate.right?.__rowIndex)) === key)?.value) || pair.value || 0),
        reasons: [...(comparison.newPairs.find((candidate) => pairKey(Number(candidate.left?.__rowIndex), Number(candidate.right?.__rowIndex)) === key)?.reasons || pair.reasons || [])]
      },
      legacyScore: {
        value: Math.round((comparison.legacyPairs.find((candidate) => pairKey(Number(candidate.left?.__rowIndex), Number(candidate.right?.__rowIndex)) === key)?.value) || 0),
        reasons: [...(comparison.legacyPairs.find((candidate) => pairKey(Number(candidate.left?.__rowIndex), Number(candidate.right?.__rowIndex)) === key)?.reasons || [])]
      }
    });
  });

  if (benchmark.aim === "mirror") {
    const mirrorRow = rows.find((row) => String(row["Mirror of"] || row.MirrorOf || row.mirrorOf || "").trim());
    const mirrorTarget = rows.find((row) => rowSalesforceId(row) === String(mirrorRow?.["Mirror of"] || mirrorRow?.MirrorOf || mirrorRow?.mirrorOf || "").trim());
    if (mirrorRow && mirrorTarget) {
      const leftIndex = Number(mirrorRow.__rowIndex);
      const rightIndex = Number(mirrorTarget.__rowIndex);
      const left = preparedRows[leftIndex];
      const right = preparedRows[rightIndex];
      const newScore = api.scoreContactPair(left, right);
      const legacyScore = api.scoreContactPairLegacy(left, right);
      pairEvidence.push({
        leftIndex,
        rightIndex,
        leftLabel: describeRow(rows[leftIndex]),
        rightLabel: describeRow(rows[rightIndex]),
        leftSalesforceId: rowSalesforceId(rows[leftIndex]),
        rightSalesforceId: rowSalesforceId(rows[rightIndex]),
        newScore: {
          value: Math.round(newScore.value),
          reasons: [...(newScore.reasons || [])]
        },
        legacyScore: {
          value: Math.round(legacyScore.value),
          reasons: [...(legacyScore.reasons || [])]
        }
      });
    }
  }

  pairEvidence.sort((left, right) => {
    const byNew = right.newScore.value - left.newScore.value;
    if (byNew !== 0) return byNew;
    return right.legacyScore.value - left.legacyScore.value;
  });

  return pairEvidence;
}

function describeRow(row) {
  const pieces = [
    row?.Name,
    [row?.FirstName, row?.LastName].filter(Boolean).join(" "),
    [row?.First_Name, row?.Last_Name].filter(Boolean).join(" "),
    row?.["First Name"] && row?.["Last Name"] ? [row["First Name"], row["Last Name"]].filter(Boolean).join(" ") : "",
    row?.Company || row?.["Account.Name"] || row?.Account || row?.Organization || ""
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const label = pieces[0] || rowSalesforceId(row) || "Unknown record";
  const company = pieces[pieces.length - 1] && pieces[pieces.length - 1] !== label ? pieces[pieces.length - 1] : "";
  return company ? `${label} @ ${company}` : label;
}

function rowSalesforceId(row) {
  return String(row?.Id || row?.ID || row?.id || "").trim();
}

function pairKey(leftIndex, rightIndex) {
  return leftIndex < rightIndex ? `${leftIndex}|${rightIndex}` : `${rightIndex}|${leftIndex}`;
}

async function writeContactModelEvaluationReport(report, options = {}) {
  const outDir = options.outDir || DEFAULT_OUT_DIR;
  const writeLatest = options.writeLatest !== false;
  await fs.mkdir(outDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const jsonFileName = `contact-model-evaluation-${timestamp}.json`;
  const markdownFileName = `contact-model-evaluation-${timestamp}.md`;
  const latestJsonFileName = "contact-model-evaluation-latest.json";
  const latestMarkdownFileName = "contact-model-evaluation-latest.md";

  const jsonPath = path.join(outDir, jsonFileName);
  const markdownPath = path.join(outDir, markdownFileName);
  const latestJsonPath = path.join(outDir, latestJsonFileName);
  const latestMarkdownPath = path.join(outDir, latestMarkdownFileName);

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, `${formatContactModelEvaluationReport(report)}\n`);
  if (writeLatest) {
    await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(latestMarkdownPath, `${formatContactModelEvaluationReport(report)}\n`);
  }

  return {
    jsonPath,
    markdownPath,
    latestJsonPath: writeLatest ? latestJsonPath : null,
    latestMarkdownPath: writeLatest ? latestMarkdownPath : null
  };
}

function formatContactModelEvaluationReport(report) {
  const lines = [];
  lines.push("# Contact Model Evaluation Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Comparison threshold: ${report.comparisonThreshold}`);
  lines.push(`Match threshold: ${report.matchThreshold}`);
  lines.push(`Prod JSON: ${report.prodJsonPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Dataset | Rows | Legacy groups ≥70 | New groups ≥70 | Delta | Red flag |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
  report.datasets.forEach((dataset) => {
    lines.push(
      `| ${escapeTableCell(dataset.label)} | ${dataset.rowCount} | ${dataset.comparison?.legacyGroupCount ?? 0} | ${dataset.comparison?.newGroupCount ?? 0} | ${dataset.comparison?.deltaGroupCount ?? 0} | ${dataset.comparison?.redFlagged ? "Yes" : "No"} |`
    );
  });
  lines.push("");
  lines.push("## Core Aims");
  lines.push("");
  lines.push(`- Same-person / same-company variants: ${report.analysis.samePersonSameCompanyVariants.pass ? "pass" : "fail"}`);
  report.analysis.samePersonSameCompanyVariants.datasets.forEach((dataset) => {
    lines.push(`  - ${dataset.label}: ${dataset.strongestPairs[0] ? `${dataset.strongestPairs[0].newScore} new / ${dataset.strongestPairs[0].legacyScore} legacy` : "no pair evidence"}`);
  });
  lines.push(`- Different-company suppression: ${report.analysis.differentCompanySuppression.pass ? "pass" : "fail"}`);
  report.analysis.differentCompanySuppression.datasets.forEach((dataset) => {
    lines.push(`  - ${dataset.label}: ${dataset.strongestPairs[0] ? `${dataset.strongestPairs[0].newScore} new / ${dataset.strongestPairs[0].legacyScore} legacy` : "no pair evidence"}`);
  });
  lines.push(`- Mirror zero exclusions: ${report.analysis.mirrorZeroExclusion.pass ? "pass" : "fail"}`);
  report.analysis.mirrorZeroExclusion.datasets.forEach((dataset) => {
    lines.push(`  - ${dataset.label}: ${dataset.strongestPairs[0] ? `${dataset.strongestPairs[0].newScore} new / ${dataset.strongestPairs[0].legacyScore} legacy` : "no pair evidence"}`);
  });
  lines.push(`- Prod coverage preserved: ${report.analysis.prodCoveragePreserved.pass ? "pass" : "fail"}`);
  if (report.analysis.prodCoveragePreserved.dataset) {
    const dataset = report.analysis.prodCoveragePreserved.dataset;
    lines.push(`  - ${dataset.label}: ${dataset.newGroupCount} new vs ${dataset.legacyGroupCount} legacy groups ≥70`);
  }
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push(report.summary.recommendation);
  lines.push("");
  lines.push("## Dataset Details");
  lines.push("");
  report.datasets.forEach((dataset) => {
    lines.push(`### ${dataset.label}`);
    lines.push("");
    lines.push(`- Source: ${dataset.source}`);
    lines.push(`- File: ${dataset.fileName}`);
    lines.push(`- Rows: ${dataset.rowCount}`);
    lines.push(`- Legacy groups ≥70: ${dataset.comparison?.legacyGroupCount ?? 0}`);
    lines.push(`- New groups ≥70: ${dataset.comparison?.newGroupCount ?? 0}`);
    lines.push(`- Delta ≥70: ${dataset.comparison?.deltaGroupCount ?? 0}`);
    lines.push(`- Red flag: ${dataset.comparison?.redFlagged ? "yes" : "no"}`);
    if (dataset.pairEvidence.length) {
      lines.push("");
      lines.push("| Pair | New | Legacy | Notes |");
      lines.push("| --- | ---: | ---: | --- |");
      dataset.pairEvidence.slice(0, 3).forEach((pair) => {
        lines.push(
          `| ${escapeTableCell(`${pair.leftLabel} <> ${pair.rightLabel}`)} | ${pair.newScore.value} | ${pair.legacyScore.value} | ${escapeTableCell(pair.newScore.reasons[0] || pair.legacyScore.reasons[0] || "")} |`
        );
      });
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function escapeTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-").replace("Z", "");
}

function parseArgs(argv) {
  const args = {
    outDir: DEFAULT_OUT_DIR,
    prodJsonPath: DEFAULT_PROD_JSON_PATH,
    quiet: false,
    includeProd: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir" && argv[index + 1]) {
      args.outDir = argv[index + 1];
      index += 1;
    } else if (arg === "--prod-json" && argv[index + 1]) {
      args.prodJsonPath = argv[index + 1];
      index += 1;
    } else if (arg === "--quiet") {
      args.quiet = true;
    } else if (arg === "--fixtures-only") {
      args.includeProd = false;
    }
  }

  return args;
}

function loadAppApi() {
  const context = {
    console,
    Blob,
    URL,
    Intl,
    performance: require("node:perf_hooks").performance,
    setTimeout,
    clearTimeout,
    FileReader: function FileReader() {},
    indexedDB: undefined,
    document: createMockDocument()
  };
  context.globalThis = context;
  vm.createContext(context);

  const appCode = require("node:fs").readFileSync(PUBLIC_APP_PATH, "utf8");
  vm.runInContext(
    `${appCode}
globalThis.__api = {
  OBJECT_CONFIG,
  state,
  parseCsv,
  inferHeaders,
  autoMapHeaders,
  prepareRows,
  buildContactMirrorConflictMap,
  collectPairGroups,
  createPairScorer,
  createLegacyPairScorer,
  getContactCandidatePairsAsync,
  scoreCandidatePairsAsync,
  summarizeGroup,
  scoreContactPairLegacy,
  scoreContactPair,
  parseDatasetText,
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

module.exports = {
  DEFAULT_BENCHMARKS,
  DEFAULT_PROD_JSON_PATH,
  CONTACT_COMPARISON_THRESHOLD,
  CONTACT_MATCH_THRESHOLD,
  generateContactModelEvaluationReport,
  formatContactModelEvaluationReport,
  writeContactModelEvaluationReport
};
