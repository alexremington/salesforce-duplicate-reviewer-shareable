#!/usr/bin/env node

const fs = require("node:fs");
const vm = require("node:vm");

const DEFAULT_THRESHOLDS = [86, 90, 95, 99];
const USAGE =
  "Usage: node scripts/check-account-calibration.js --labels <labels.csv> --source <source.csv> [--object account|contact] [--assert-threshold 86]";

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.labels || !args.source) throw new Error(USAGE);

  const api = loadAppApi();
  const labels = readCsvRows(api, args.labels);
  const objectType = normalizeObjectType(api, args.objectType || labels.find((row) => row.object_type)?.object_type || "account");
  const source = prepareSource(api, args.source, objectType);
  const scoredLabels = scoreLabels(api, labels, source);
  const summary = summarize(scoredLabels);

  console.log(JSON.stringify({ objectType, ...summary }, null, 2));
  assertThreshold(scoredLabels, args.assertThreshold);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--labels") {
      parsed.labels = args[index + 1];
      index += 1;
    } else if (arg === "--source") {
      parsed.source = args[index + 1];
      index += 1;
    } else if (arg === "--assert-threshold") {
      parsed.assertThreshold = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--object") {
      parsed.objectType = args[index + 1];
      index += 1;
    } else {
      throw new Error(`${USAGE}\nUnknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readCsvRows(api, path) {
  return api.parseCsv(fs.readFileSync(path, "utf8")).rows;
}

function normalizeObjectType(api, objectType) {
  if (api.OBJECT_CONFIG[objectType]) return objectType;
  throw new Error(`${USAGE}\nUnsupported object type: ${objectType}`);
}

function prepareSource(api, sourcePath, objectType) {
  const source = api.parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const rows = source.rows.map((row, index) => ({
    ...row,
    __rowIndex: index
  }));
  const headers = source.headers.length ? source.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG[objectType].fields);
  const preparedRows = api.prepareRows(rows, objectType, mapping);

  api.state.objectType = objectType;
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  return {
    objectType,
    rows,
    mapping,
    preparedRows,
    fieldStats: api.buildFieldStats(preparedRows, objectType),
    preparedById: indexPreparedRowsById(api, rows, preparedRows, mapping)
  };
}

function indexPreparedRowsById(api, rows, preparedRows, mapping) {
  const preparedById = new Map();
  rows.forEach((row, index) => {
    const id = api.getValue(row, mapping.recordId) || `row-${row.__rowIndex + 1}`;
    preparedById.set(id, preparedRows[index]);
  });
  return preparedById;
}

function scoreLabels(api, labels, source) {
  return labels.map((label) => {
    const left = source.preparedById.get(label.left_salesforce_id) || source.preparedById.get(label.left_record_key);
    const right = source.preparedById.get(label.right_salesforce_id) || source.preparedById.get(label.right_record_key);
    const score = left && right ? scorePreparedLabelPair(api, left, right, source) : null;

    return {
      ...label,
      currentScore: score ? Math.round(score.value) : Number(label.pair_score || 0),
      currentReasons: score ? score.reasons : [],
      currentFieldScores: score ? score.fieldScores : null,
      sourceRowsFound: Boolean(left && right)
    };
  });
}

function scorePreparedLabelPair(api, left, right, source) {
  if (source.objectType === "contact") return api.scoreContactPair(left, right);
  return api.scoreAccountPair(left, right, source.fieldStats);
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

  const appCode = fs.readFileSync("public/app.js", "utf8");
  vm.runInContext(
    `${appCode}
globalThis.__api = {
  OBJECT_CONFIG,
  state,
  parseCsv,
  inferHeaders,
  autoMapHeaders,
  prepareRows,
  buildFieldStats,
  scoreAccountPair,
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

function summarize(rows) {
  return {
    rows: rows.length,
    sourceRowsFound: rows.filter((row) => row.sourceRowsFound).length,
    labels: countBy(rows, "label"),
    scoreRanges: scoreRanges(rows),
    thresholds: Object.fromEntries(DEFAULT_THRESHOLDS.map((threshold) => [threshold, thresholdMetrics(rows, threshold)])),
    highScoringNonMatches: highestScoringRows(rows, "not_match", 86),
    lowScoringMatches: lowestScoringRows(rows, "match", 95)
  };
}

function thresholdMetrics(rows, threshold) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  rows.forEach((row) => {
    const predictedMatch = row.currentScore >= threshold;
    if (row.label === "match" && predictedMatch) truePositive += 1;
    if (row.label === "match" && !predictedMatch) falseNegative += 1;
    if (row.label === "not_match" && predictedMatch) falsePositive += 1;
    if (row.label === "not_match" && !predictedMatch) trueNegative += 1;
  });

  return {
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative)
  };
}

function assertThreshold(rows, threshold) {
  if (threshold == null || Number.isNaN(threshold)) return;
  const errors = thresholdErrors(rows, threshold);
  if (!errors.length) return;

  console.error(JSON.stringify({ assertThreshold: threshold, errors }, null, 2));
  process.exitCode = 1;
}

function thresholdErrors(rows, threshold) {
  return rows
    .filter((row) => {
      if (row.label === "match") return row.currentScore < threshold;
      if (row.label === "not_match") return row.currentScore >= threshold;
      return false;
    })
    .map(compactRow);
}

function scoreRanges(rows) {
  const ranges = {};
  ["match", "not_match", "unsure"].forEach((label) => {
    const scores = rows.filter((row) => row.label === label).map((row) => row.currentScore);
    if (!scores.length) return;
    ranges[label] = {
      min: Math.min(...scores),
      max: Math.max(...scores),
      mean: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    };
  });
  return ranges;
}

function highestScoringRows(rows, label, minimumScore) {
  return rows
    .filter((row) => row.label === label && row.currentScore >= minimumScore)
    .sort((left, right) => right.currentScore - left.currentScore)
    .slice(0, 12)
    .map(compactRow);
}

function lowestScoringRows(rows, label, maximumScore) {
  return rows
    .filter((row) => row.label === label && row.currentScore < maximumScore)
    .sort((left, right) => left.currentScore - right.currentScore)
    .map(compactRow);
}

function compactRow(row) {
  return {
    score: row.currentScore,
    label: row.label,
    left: row.left_name,
    right: row.right_name,
    reasons: row.currentReasons
  };
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] || 0) + 1;
    return counts;
  }, {});
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

main();
