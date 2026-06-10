#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DEFAULT_CONFIDENCE = "high";
const TRAINING_LABEL = "match";
const DEFAULT_USAGE =
  "Usage: node scripts/export-salesforce-duplicate-training-labels.js --duplicate-items <duplicate-items.csv> --source <source.csv> --output <labels.csv> [--object account|contact] [--confidence high|medium|low] [--file-name <name>]";

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.duplicateItems || !args.source || !args.output) throw new Error(DEFAULT_USAGE);

  const api = loadAppApi();
  const duplicateRows = api.parseCsv(fs.readFileSync(args.duplicateItems, "utf8")).rows;
  const objectType = normalizeObjectType(api, args.objectType || inferObjectType(duplicateRows) || "account");
  const source = prepareSource(api, args.source, objectType);
  const clusters = groupDuplicateItems(duplicateRows, objectType);
  const result = buildTrainingLabels(api, source, clusters, {
    confidence: normalizeConfidence(args.confidence),
    fileName: args.fileName || path.basename(args.source)
  });

  if (!result.rows.length) {
    console.warn("No duplicate pairs were exported.");
  }

  const output = [result.header, ...result.rows].map(serializeCsvRow).join("\n") + "\n";
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, output);

  console.log(
    JSON.stringify(
      {
        objectType,
        output: args.output,
        duplicateSets: result.duplicateSets,
        exportedPairs: result.rows.length,
        skippedMissingSourceRecords: result.skippedMissingSourceRecords,
        skippedCrossObjectRows: result.skippedCrossObjectRows,
        skippedDuplicatePairs: result.skippedDuplicatePairs
      },
      null,
      2
    )
  );
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--duplicate-items") {
      parsed.duplicateItems = args[index + 1];
      index += 1;
    } else if (arg === "--source") {
      parsed.source = args[index + 1];
      index += 1;
    } else if (arg === "--output") {
      parsed.output = args[index + 1];
      index += 1;
    } else if (arg === "--object") {
      parsed.objectType = args[index + 1];
      index += 1;
    } else if (arg === "--confidence") {
      parsed.confidence = args[index + 1];
      index += 1;
    } else if (arg === "--file-name") {
      parsed.fileName = args[index + 1];
      index += 1;
    } else {
      throw new Error(`${DEFAULT_USAGE}\nUnknown argument: ${arg}`);
    }
  }
  return parsed;
}

function normalizeConfidence(confidence) {
  return ["high", "medium", "low"].includes(confidence) ? confidence : DEFAULT_CONFIDENCE;
}

function normalizeObjectType(api, objectType) {
  const value = String(objectType || "").toLowerCase();
  if (api.OBJECT_CONFIG[value]) return value;
  throw new Error(`${DEFAULT_USAGE}\nUnsupported object type: ${objectType}`);
}

function inferObjectType(rows) {
  for (const row of rows) {
    const value = readRowValue(row, [
      "DuplicateRecordSet.SObjectType",
      "DuplicateRecordSet.SObjectType__c",
      "DuplicateRecordSetSObjectType",
      "object_type",
      "sobjecttype",
      "sobject_type"
    ]);
    if (!value) continue;
    const normalized = String(value).toLowerCase();
    if (normalized === "account" || normalized === "contact") return normalized;
  }
  return "";
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
  const preparedById = new Map();

  rows.forEach((row, index) => {
    const recordId = api.getValue(row, mapping.recordId) || `row-${row.__rowIndex + 1}`;
    preparedById.set(recordId, {
      row,
      prepared: preparedRows[index],
      recordId
    });
  });

  api.state.objectType = objectType;
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;

  return {
    objectType,
    rows,
    headers,
    mapping,
    preparedRows,
    preparedById,
    fieldStats: api.buildFieldStats(preparedRows, objectType),
    sourceFileName: path.basename(sourcePath)
  };
}

function groupDuplicateItems(rows, objectType) {
  const clusters = new Map();
  let skippedCrossObjectRows = 0;

  rows.forEach((row) => {
    const recordId = readRowValue(row, ["RecordId", "record_id", "recordid"]);
    const setId = readRowValue(row, ["DuplicateRecordSetId", "duplicate_record_set_id", "duplicaterecordsetid"]);
    if (!recordId || !setId) return;

    const rowObjectType = readRowValue(row, [
      "DuplicateRecordSet.SObjectType",
      "DuplicateRecordSet.SObjectType__c",
      "DuplicateRecordSetSObjectType",
      "object_type",
      "sobjecttype",
      "sobject_type"
    ]);
    if (rowObjectType && String(rowObjectType).toLowerCase() !== objectType) {
      skippedCrossObjectRows += 1;
      return;
    }

    if (!clusters.has(setId)) {
      clusters.set(setId, { recordIds: new Set() });
    }
    clusters.get(setId).recordIds.add(recordId);
  });

  return {
    clusters: [...clusters.entries()]
      .map(([setId, cluster]) => ({ setId, recordIds: [...cluster.recordIds] }))
      .filter((cluster) => cluster.recordIds.length > 1)
      .sort((left, right) => left.setId.localeCompare(right.setId)),
    skippedCrossObjectRows
  };
}

function buildTrainingLabels(api, source, groupedItems, { confidence, fileName }) {
  const header = [
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
  ];

  const rows = [];
  const seenPairs = new Set();
  let skippedMissingSourceRecords = 0;
  let skippedDuplicatePairs = 0;
  const now = new Date().toISOString();

  groupedItems.clusters.forEach((cluster) => {
    const clusterPairs = [];

    for (let leftIndex = 0; leftIndex < cluster.recordIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < cluster.recordIds.length; rightIndex += 1) {
        const leftId = cluster.recordIds[leftIndex];
        const rightId = cluster.recordIds[rightIndex];
        const pairKey = pairKeyFromIds(leftId, rightId);
        if (seenPairs.has(pairKey)) {
          skippedDuplicatePairs += 1;
          continue;
        }

        const leftEntry = source.preparedById.get(leftId);
        const rightEntry = source.preparedById.get(rightId);
        if (!leftEntry || !rightEntry) {
          skippedMissingSourceRecords += 1;
          continue;
        }

        const score = scorePair(api, source, leftEntry.prepared, rightEntry.prepared);
        clusterPairs.push({
          pairKey,
          leftId,
          rightId,
          leftName: api.displayName(leftEntry.row),
          rightName: api.displayName(rightEntry.row),
          score
        });
        seenPairs.add(pairKey);
      }
    }

    if (!clusterPairs.length) return;

    const groupScore = Math.max(...clusterPairs.map((pair) => Math.round(pair.score.value)));
    const minPairScore = Math.min(...clusterPairs.map((pair) => Math.round(pair.score.value)));

    clusterPairs
      .sort((left, right) => {
        const scoreDelta = Math.round(right.score.value) - Math.round(left.score.value);
        if (scoreDelta) return scoreDelta;
        return left.pairKey.localeCompare(right.pairKey);
      })
      .forEach((pair) => {
        rows.push([
          source.objectType,
          fileName,
          cluster.setId,
          String(groupScore),
          String(minPairScore),
          pair.leftId,
          pair.rightId,
          pair.leftId,
          pair.rightId,
          pair.leftName,
          pair.rightName,
          String(Math.round(pair.score.value)),
          TRAINING_LABEL,
          confidence,
          pair.score.reasons.join("; "),
          JSON.stringify(pair.score.fieldScores),
          now,
          now
        ]);
      });
  });

  return {
    header,
    rows,
    duplicateSets: groupedItems.clusters.length,
    skippedMissingSourceRecords,
    skippedCrossObjectRows: groupedItems.skippedCrossObjectRows,
    skippedDuplicatePairs
  };
}

function scorePair(api, source, left, right) {
  if (source.objectType === "contact") return api.scoreContactPair(left, right);
  return api.scoreAccountPair(left, right, source.fieldStats);
}

function pairKeyFromIds(leftId, rightId) {
  return [leftId, rightId].sort().join("::");
}

function readRowValue(row, fieldNames) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeaderKey(key), value]));
  for (const fieldName of fieldNames) {
    const value = normalized.get(normalizeHeaderKey(fieldName));
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeHeaderKey(header) {
  return String(header || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function serializeCsvRow(row) {
  return row.map(serializeCsvCell).join(",");
}

function serializeCsvCell(value) {
  const text = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
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

  const appCode = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
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
  getValue,
  displayName
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

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
