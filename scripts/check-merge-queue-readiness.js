#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_DIR = path.resolve(__dirname, "..");
const USAGE = [
  "Usage:",
  "  node scripts/check-merge-queue-readiness.js --workspace <workspace.json> --source <dataset.csv> [--json]",
  "  node scripts/check-merge-queue-readiness.js --self-check"
].join("\n");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    await runSelfCheck();
    console.log("Merge queue readiness self-check passed.");
    return;
  }

  if (!args.workspacePath || !args.sourcePath) {
    throw new Error(USAGE);
  }

  const result = await analyzeMergeQueueReadiness({
    workspacePath: args.workspacePath,
    sourcePath: args.sourcePath
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHumanSummary(result);
}

function parseArgs(args) {
  const parsed = {
    json: false,
    selfCheck: false,
    sourcePath: "",
    workspacePath: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace") {
      parsed.workspacePath = args[index + 1] || "";
      index += 1;
    } else if (arg === "--source") {
      parsed.sourcePath = args[index + 1] || "";
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--self-check") {
      parsed.selfCheck = true;
    } else {
      throw new Error(`${USAGE}\nUnknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function analyzeMergeQueueReadiness({ workspacePath, sourcePath }) {
  const api = loadAppApi();
  const workspace = readWorkspaceRecord(workspacePath);
  const objectType = normalizeObjectType(workspace.objectType || "contact");
  if (objectType !== "contact") {
    throw new Error(`Only Contact merge queue readiness is supported. Received objectType=${objectType}.`);
  }

  const source = await prepareSource(api, sourcePath, objectType);
  applyWorkspaceState(api, workspace, source.groups);
  const results = evaluateWorkspaceDecisions(api, workspace, source);
  const counts = summarizeCounts(results);

  return {
    objectType,
    workspacePath,
    sourcePath,
    counts,
    groups: results
  };
}

function readWorkspaceRecord(workspacePath) {
  const raw = JSON.parse(fs.readFileSync(workspacePath, "utf8"));
  const record = normalizeWorkspaceRecord(raw);
  if (!record) {
    throw new Error(`Workspace file is not a recognized duplicate-reviewer workspace: ${workspacePath}`);
  }
  return record;
}

function normalizeWorkspaceRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.reviewState && typeof raw.reviewState === "object") return raw.reviewState;
  if (raw.workspace && typeof raw.workspace === "object") return raw.workspace;
  if (Array.isArray(raw.decisions) || Array.isArray(raw.trainingLabels)) return raw;
  return null;
}

function normalizeObjectType(objectType) {
  const value = String(objectType || "").trim().toLowerCase();
  if (value === "contact" || value === "account") return value;
  throw new Error(`Unsupported object type: ${objectType}`);
}

async function prepareSource(api, sourcePath, objectType) {
  const source = api.parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const rows = source.rows.map((row, index) => ({
    ...row,
    __rowIndex: index
  }));
  const headers = source.headers.length ? source.headers : api.inferHeaders(rows);
  const mapping = api.autoMapHeaders(headers, api.OBJECT_CONFIG[objectType].fields);

  resetRuntimeState(api, { objectType, rows, headers, mapping });

  const groups = hasScoredGroupColumn(headers)
    ? rebuildGroupsFromScoredDataset(api, rows, headers)
    : (await api.buildGroupsAsync(rows, objectType, mapping, 86)).groups;

  api.state.groups = groups;
  return {
    headers,
    mapping,
    rows,
    groups,
    recordsByKey: new Map(rows.map((row) => [api.recordKey(row), row])),
    groupsByKey: new Map(groups.map((group) => [group.key, group]))
  };
}

function resetRuntimeState(api, { objectType, rows, headers, mapping }) {
  api.state.objectType = objectType;
  api.state.rows = rows;
  api.state.headers = headers;
  api.state.mapping = mapping;
  api.state.groups = [];
  api.state.decisions = new Map();
  api.state.mergeResults = new Map();
  api.state.fieldResolutions = new Map();
  api.state.separatedRecords = new Map();
  api.state.trainingLabels = new Map();
  api.state.maxThreshold = 100;
  api.state.sortDirection = "desc";
  api.state.selectedGroupKey = "";
  api.mergeMasterSelections.clear();
  api.mergeInFlightGroupKeys.clear();
}

function hasScoredGroupColumn(headers) {
  return headers.some((header) => String(header || "").trim().toLowerCase() === "group");
}

function rebuildGroupsFromScoredDataset(api, rows, headers) {
  const groupHeader = headers.find((header) => String(header || "").trim().toLowerCase() === "group");
  const scoreHeader = headers.find((header) => String(header || "").trim().toLowerCase() === "score");
  const buckets = new Map();

  rows.forEach((row) => {
    const groupId = String(row[groupHeader] || "").trim();
    if (!groupId) return;
    if (!buckets.has(groupId)) buckets.set(groupId, []);
    buckets.get(groupId).push(row);
  });

  return [...buckets.entries()]
    .map(([groupId, groupRows], index) => {
      const records = [...groupRows].sort((left, right) => left.__rowIndex - right.__rowIndex);
      const score = Math.max(...records.map((record) => Number(record[scoreHeader]) || 0));
      return {
        id: Number(groupId) || index + 1,
        key: records.map((record) => api.recordKey(record)).sort().join("|"),
        records,
        pairs: [],
        bestPair: null,
        score,
        minPairScore: score,
        matchedFieldPercent: 0,
        type: "scored-export",
        reasons: []
      };
    })
    .filter((group) => group.records.length >= 2)
    .sort((left, right) => left.id - right.id);
}

function applyWorkspaceState(api, workspace, groups) {
  const groupsByKey = new Map(groups.map((group) => [group.key, group]));
  const validFields = new Set(api.OBJECT_CONFIG[api.state.objectType].displayFields);

  for (const entry of toEntryList(workspace.decisions)) {
    const [groupKey, decision] = entry;
    if (!groupsByKey.has(groupKey)) continue;
    if (decision !== "duplicate" && decision !== "not-duplicate") continue;
    api.state.decisions.set(groupKey, decision);
  }

  for (const entry of toEntryList(workspace.mergeResults)) {
    const [groupKey, result] = entry;
    if (!groupsByKey.has(groupKey) || !result || typeof result !== "object") continue;
    api.state.mergeResults.set(groupKey, result);
  }

  for (const entry of toEntryList(workspace.mergeMasterSelections)) {
    const [groupKey, value] = entry;
    const group = groupsByKey.get(groupKey);
    const normalizedId = api.normalizeSalesforceIdForMerge(value);
    if (!group || !normalizedId) continue;
    const validIds = new Set(group.records.map((record) => api.normalizeSalesforceIdForMerge(api.salesforceId(record))).filter(Boolean));
    if (!validIds.has(normalizedId)) continue;
    api.mergeMasterSelections.set(groupKey, normalizedId);
  }

  for (const entry of toEntryList(workspace.fieldResolutions)) {
    const [groupKey, values] = entry;
    if (!groupsByKey.has(groupKey) || !values || typeof values !== "object") continue;
    const restored = {};
    for (const [field, value] of Object.entries(values)) {
      if (validFields.has(field)) restored[field] = String(value ?? "");
    }
    if (Object.keys(restored).length) api.state.fieldResolutions.set(groupKey, restored);
  }

  for (const entry of toEntryList(workspace.separatedRecords)) {
    const [groupKey, recordKeys] = entry;
    const group = groupsByKey.get(groupKey);
    if (!group || !Array.isArray(recordKeys)) continue;
    const validKeys = new Set(group.records.map((record) => api.recordKey(record)));
    const restored = new Set(recordKeys.filter((key) => validKeys.has(key)));
    if (restored.size) api.state.separatedRecords.set(groupKey, restored);
  }
}

function toEntryList(entries) {
  return Array.isArray(entries) ? entries.filter(Array.isArray) : [];
}

function evaluateWorkspaceDecisions(api, workspace, source) {
  return toEntryList(workspace.decisions).map((entry, index) => {
    const [groupKey, decision] = entry;
    const recordKeys = String(groupKey || "").split("|").filter(Boolean);
    const missingRecordKeys = recordKeys.filter((recordKey) => !source.recordsByKey.has(recordKey));
    const group = source.groupsByKey.get(groupKey) || null;

    if (missingRecordKeys.length) {
      return {
        index: index + 1,
        groupId: group?.id || null,
        groupKey,
        recordKeys,
        decision,
        status: "blocked",
        blockerReason: missingSourceRecordMessage(missingRecordKeys),
        selectedMasterId: "",
        duplicateRecordIds: [],
        activeRecordCount: 0
      };
    }

    if (!group) {
      return {
        index: index + 1,
        groupId: null,
        groupKey,
        recordKeys,
        decision,
        status: "blocked",
        blockerReason: "Saved decision group was not found in the scored dataset.",
        selectedMasterId: "",
        duplicateRecordIds: [],
        activeRecordCount: 0
      };
    }

    const activeRecords = api.getActiveGroupRecords(group);
    const mergeState = api.getMergeState(group, activeRecords, api.state.decisions.get(group.key) || decision || "");
    return {
      index: index + 1,
      groupId: group.id ?? null,
      groupKey,
      recordKeys,
      decision,
      status: mergeState.canSubmit ? "queueable" : "blocked",
      blockerReason: mergeState.canSubmit ? "" : mergeState.description,
      selectedMasterId: mergeState.selectedId,
      duplicateRecordIds: mergeState.mergeRecords.map((record) => record.id),
      activeRecordCount: activeRecords.length
    };
  });
}

function missingSourceRecordMessage(recordKeys) {
  return `Saved decision references source records missing from the scored dataset: ${recordKeys.join(", ")}`;
}

function summarizeCounts(groups) {
  const queueable = groups.filter((group) => group.status === "queueable").length;
  const blocked = groups.length - queueable;
  return {
    total: groups.length,
    queueable,
    blocked
  };
}

function printHumanSummary(result) {
  result.groups.forEach((group) => {
    if (group.status === "queueable") {
      console.log(
        `[queueable] group ${group.groupId ?? group.index} master=${group.selectedMasterId} duplicates=${group.duplicateRecordIds.length} key=${group.groupKey}`
      );
      return;
    }

    console.log(
      `[blocked] group ${group.groupId ?? group.index} reason=${group.blockerReason} key=${group.groupKey}`
    );
  });

  console.log(
    `Summary: ${result.counts.queueable} queueable, ${result.counts.blocked} blocked, ${result.counts.total} total.`
  );
}

async function runSelfCheck() {
  await runFixtureCase({
    name: "non-duplicate decision",
    workspace: {
      objectType: "contact",
      decisions: [[pairKey([makeId("003", 1), makeId("003", 2)]), "not-duplicate"]]
    },
    rows: baseRows([
      { id: makeId("003", 1), name: "Alpha Contact", group: 1 },
      { id: makeId("003", 2), name: "Alpha Contact", group: 1 }
    ]),
    expectedBlockedIncludes: "Mark this group Duplicate before merging."
  });

  await runFixtureCase({
    name: "missing source record",
    workspace: {
      objectType: "contact",
      decisions: [[pairKey([makeId("003", 1), makeId("003", 999)]), "duplicate"]]
    },
    rows: baseRows([
      { id: makeId("003", 1), name: "Alpha Contact", group: 1 }
    ]),
    expectedBlockedIncludes: "missing from the scored dataset"
  });

  await runFixtureCase({
    name: "invalid contact id prefix",
    workspace: {
      objectType: "contact",
      decisions: [[pairKey([makeId("001", 1), makeId("001", 2)]), "duplicate"]]
    },
    rows: baseRows([
      { id: makeId("001", 1), name: "Alpha Contact", group: 1 },
      { id: makeId("001", 2), name: "Alpha Contact", group: 1 }
    ]),
    expectedBlockedIncludes: "missing valid Salesforce Contact IDs"
  });

  await runFixtureCase({
    name: "over-20 duplicate group",
    workspace: {
      objectType: "contact",
      decisions: [[pairKey(Array.from({ length: 22 }, (_, index) => makeId("003", index + 1))), "duplicate"]]
    },
    rows: baseRows(
      Array.from({ length: 22 }, (_, index) => ({
        id: makeId("003", index + 1),
        name: `Large Group ${index + 1}`,
        group: 1
      }))
    ),
    expectedBlockedIncludes: "up to 20 duplicate records"
  });
}

async function runFixtureCase({ name, workspace, rows, expectedBlockedIncludes }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-reviewer-merge-queue-"));
  const workspacePath = path.join(tempDir, "workspace.json");
  const sourcePath = path.join(tempDir, "source.csv");

  try {
    fs.writeFileSync(workspacePath, `${JSON.stringify({
      version: 1,
      mergeResults: [],
      mergeMasterSelections: [],
      fieldResolutions: [],
      separatedRecords: [],
      trainingLabels: [],
      ...workspace
    }, null, 2)}\n`);
    fs.writeFileSync(sourcePath, rowsToCsv(rows));

    const result = await analyzeMergeQueueReadiness({ workspacePath, sourcePath });
    assert.equal(result.counts.total, 1, `${name}: expected exactly one checked group`);
    assert.equal(result.counts.blocked, 1, `${name}: expected blocked group`);
    assert.match(result.groups[0].blockerReason, new RegExp(escapeForRegExp(expectedBlockedIncludes)), `${name}: wrong blocker`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function baseRows(rows) {
  return rows.map((row) => ({
    Id: row.id,
    Name: row.name,
    "Account.Name": row.accountName || "",
    Email: row.email || "",
    Phone: row.phone || "",
    group: row.group,
    score: row.score || 100
  }));
}

function rowsToCsv(rows) {
  const headers = Object.keys(rows[0] || {
    Id: "",
    Name: "",
    "Account.Name": "",
    Email: "",
    Phone: "",
    group: "",
    score: ""
  });
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function pairKey(ids) {
  return [...ids].sort().join("|");
}

function makeId(prefix, index) {
  return `${prefix}${String(index).padStart(12, "0")}`;
}

function escapeForRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadAppApi() {
  const context = {
    console,
    Blob,
    URL,
    URLSearchParams,
    Intl,
    FileReader: function FileReader() {},
    indexedDB: undefined,
    performance: { now: () => Date.now() },
    requestAnimationFrame(callback) {
      return setTimeout(() => callback(Date.now()), 0);
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle);
    },
    setTimeout,
    clearTimeout,
    fetch: async () => ({
      ok: true,
      json: async () => ({ orgs: [] })
    }),
    document: createMockDocument()
  };
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  context.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  context.navigator = { userAgent: "node" };
  context.location = { search: "", hash: "", href: "http://127.0.0.1/" };
  context.history = { replaceState() {}, pushState() {} };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  const appCode = fs.readFileSync(path.join(PROJECT_DIR, "public", "app.js"), "utf8");
  vm.runInContext(
    `${appCode}
globalThis.__api = {
  OBJECT_CONFIG,
  state,
  parseCsv,
  inferHeaders,
  autoMapHeaders,
  buildGroupsAsync,
  recordKey,
  salesforceId,
  normalizeSalesforceIdForMerge,
  getActiveGroupRecords,
  getMergeState,
  mergeMasterSelections,
  mergeInFlightGroupKeys
};`,
    context
  );

  return context.__api;
}

function createMockDocument() {
  const elements = new Map();
  return {
    body: createMockElement("body"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createMockElement(id));
      return elements.get(id);
    },
    addEventListener() {},
    querySelector() {
      return createMockElement("query");
    },
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
    value: id === "threshold" ? "86" : id === "maxThreshold" ? "100" : "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    checked: false,
    indeterminate: false,
    files: [],
    style: { setProperty() {} },
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    append() {},
    appendChild() {},
    removeChild() {},
    replaceChildren() {},
    remove() {},
    focus() {},
    click() {},
    setAttribute() {},
    getAttribute() {
      return "";
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  analyzeMergeQueueReadiness
};
