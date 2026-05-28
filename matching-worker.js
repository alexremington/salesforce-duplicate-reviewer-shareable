self.__DUPLICATE_REVIEWER_MATCHING_WORKER__ = true;
self.window = {
  location: self.location,
  addEventListener() {},
  alert() {},
  confirm() {
    return false;
  }
};
self.HTMLElement = function HTMLElement() {};
self.document = createMockDocument();

importScripts("app.js");

self.onmessage = async (event) => {
  const { jobId, payload } = event.data || {};
  try {
    const result = await processMatchingJobOnMain(payload, (message, progress) => {
      self.postMessage({
        jobId,
        type: "progress",
        message,
        progress
      });
      return Promise.resolve();
    });
    self.postMessage({ jobId, type: "result", result });
  } catch (error) {
    self.postMessage({
      jobId,
      type: "error",
      message: error?.message || "Matching worker failed."
    });
  }
};

function createMockDocument() {
  const elements = new Map();
  const body = createMockElement("body");
  return {
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
