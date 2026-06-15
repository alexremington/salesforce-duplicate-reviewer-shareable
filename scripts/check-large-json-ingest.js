const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const projectDir = path.resolve(__dirname, "..");
const appPath = path.join(projectDir, "public", "app.js");
const source = fs.readFileSync(appPath, "utf8");

const context = vm.createContext(createMockGlobal());
vm.runInContext(source, context, { filename: appPath });

runChecks();

function runChecks() {
  const threshold = 50 * 1024 * 1024;

  ensure(
    vm.runInContext(`shouldDeferJsonIngest({ format: "json", size: ${threshold - 1} })`, context) === false,
    "expected JSON files just below the threshold to stay eager"
  );
  ensure(
    vm.runInContext(`shouldDeferJsonIngest({ format: "json", size: ${threshold} })`, context) === true,
    "expected JSON files at the threshold to defer matching"
  );
  ensure(
    vm.runInContext(`shouldDeferJsonIngest({ format: "csv", size: ${threshold * 2} })`, context) === false,
    "expected CSV files to keep the existing eager path"
  );

  const parsed = vm.runInContext(
    `parseDatasetText(${JSON.stringify(JSON.stringify({
      objectType: "contact",
      records: [
        { Id: "003A", Name: "First", Metadata: { nested: true }, Notes: "alpha" },
        { Id: "003B", Name: "Second", Metadata: { nested: false }, Notes: "beta" }
      ]
    }))}, { format: "json", fileName: "fixture.json", objectType: "contact" })`,
    context
  );
  ensure(parsed.rows.length === 2, "expected JSON rows to preserve row order");
  ensure(parsed.rows[0].Id === "003A" && parsed.rows[1].Id === "003B", "expected JSON row order to stay stable");
  ensure(parsed.rows[0].Metadata === JSON.stringify({ nested: true }), "expected nested objects to be stringified");

  assert.throws(
    () => vm.runInContext(`parseDatasetText("{", { format: "json", fileName: "broken.json", objectType: "contact" })`, context),
    /Unexpected end of JSON input|JSON/,
    "expected malformed JSON to fail"
  );

  vm.runInContext(`
    activeLoadReader = { aborted: false, abort() { this.aborted = true; } };
    activeLoadAbortController = { aborted: false, abort() { this.aborted = true; } };
    matchingWorkerRunner = { terminated: false, terminate() { this.terminated = true; } };
    state.isLoadingFile = true;
    state.loadingModal.active = true;
  `, context);
  vm.runInContext("cancelActiveLoad()", context);
  const cancelState = vm.runInContext(`({
    isLoadingFile: state.isLoadingFile,
    modalActive: state.loadingModal.active,
    readerAborted: activeLoadReader ? activeLoadReader.aborted : true,
    controllerAborted: activeLoadAbortController ? activeLoadAbortController.aborted : true,
    workerTerminated: matchingWorkerRunner ? matchingWorkerRunner.terminated : false
  })`, context);
  ensure(cancelState.isLoadingFile === false, "expected cancel to stop the active load");
  ensure(cancelState.modalActive === false, "expected cancel to hide the loading modal");
  ensure(cancelState.readerAborted === true, "expected cancel to abort the reader");
  ensure(cancelState.controllerAborted === true, "expected cancel to abort the fetch controller");
  ensure(cancelState.workerTerminated === true, "expected cancel to terminate the worker job");

  console.log("Large JSON ingest strategy checks passed.");
}

function createMockGlobal() {
  const elements = new Map();
  const body = createMockElement("body");
  const document = {
    body,
    activeElement: null,
    visibilityState: "visible",
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createMockElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    createElement(tagName) {
      return createMockElement(tagName);
    },
    addEventListener() {}
  };

  return {
    self: { __DUPLICATE_REVIEWER_MATCHING_WORKER__: true },
    window: {
      location: {
        protocol: "http:"
      },
      addEventListener() {},
      removeEventListener() {}
    },
    document,
    HTMLElement: function HTMLElement() {},
    DOMException: global.DOMException,
    console,
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle);
    },
    setTimeout,
    clearTimeout,
    indexedDB: undefined,
    localStorage: undefined,
    fetch() {
      throw new Error("fetch should not be called by the unit regression");
    },
    performance: { now: () => Date.now() },
    AbortController,
    URL,
    JSON,
    Math,
    Date,
    Array,
    Map,
    Set,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Promise
  };
}

function createMockElement(id) {
  return {
    id,
    hidden: false,
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: {
      setProperty() {}
    },
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener() {},
    setAttribute() {},
    getAttribute() {
      return "";
    },
    append() {},
    appendChild() {},
    focus() {},
    click() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
