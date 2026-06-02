(function attachManagedWorkerClient(global) {
  "use strict";

  function createAbortError(message) {
    try {
      return new DOMException(message || "Worker job was aborted.", "AbortError");
    } catch {
      const error = new Error(message || "Worker job was aborted.");
      error.name = "AbortError";
      return error;
    }
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  function createJobRunner({
    workerUrl,
    workerOptions,
    canUseWorker = defaultCanUseWorker,
    fallback,
    onFallback,
    resultMode = "worker"
  }) {
    if (!workerUrl) throw new Error("workerUrl is required.");

    let activeJob = null;
    let sequence = 0;

    function terminateActive(reason = "Worker job was replaced by a newer request.") {
      if (!activeJob) return;
      const job = activeJob;
      activeJob = null;
      job.worker.terminate();
      job.reject(createAbortError(reason));
    }

    async function runFallback(payload, progress, error) {
      if (error && typeof onFallback === "function") {
        onFallback(error);
      }
      if (typeof fallback !== "function") {
        throw error || new Error("Worker is unavailable and no fallback was provided.");
      }
      return fallback(payload, progress);
    }

    function run(payload, { progress = noopProgress, transfer = [] } = {}) {
      if (!canUseWorker()) {
        return runFallback(payload, progress);
      }

      terminateActive();

      let worker;
      try {
        worker = new global.Worker(workerUrl, workerOptions);
      } catch (error) {
        return runFallback(payload, progress, error);
      }

      const jobId = ++sequence;

      return new Promise((resolve, reject) => {
        activeJob = { id: jobId, worker, reject };

        function cleanup() {
          if (activeJob?.id === jobId) activeJob = null;
          worker.terminate();
        }

        function rejectOrFallback(error) {
          cleanup();
          if (isAbortError(error)) {
            reject(error);
            return;
          }
          runFallback(payload, progress, error).then(resolve, reject);
        }

        worker.onmessage = (event) => {
          const message = event.data || {};
          if (!activeJob || activeJob.id !== jobId) return;

          if (message.type === "progress") {
            Promise.resolve(progress(message.message, message.progress)).catch(() => {});
            return;
          }

          if (message.type === "result") {
            cleanup();
            resolve(decorateWorkerResult(message.result, resultMode));
            return;
          }

          if (message.type === "error") {
            rejectOrFallback(new Error(message.message || "Worker job failed."));
          }
        };

        worker.onerror = (event) => {
          if (!activeJob || activeJob.id !== jobId) return;
          rejectOrFallback(new Error(event.message || "Worker job failed."));
        };

        try {
          worker.postMessage({ jobId, payload }, Array.isArray(transfer) ? transfer : []);
        } catch (error) {
          rejectOrFallback(error);
        }
      });
    }

    return {
      run,
      terminate: terminateActive
    };
  }

  function defaultCanUseWorker() {
    return typeof global.Worker !== "undefined";
  }

  function decorateWorkerResult(result, resultMode) {
    if (!result || typeof result !== "object" || Array.isArray(result)) return result;
    return {
      ...result,
      processingMode: resultMode || result.processingMode
    };
  }

  async function noopProgress() {}

  global.ManagedWorkerClient = {
    createAbortError,
    isAbortError,
    createJobRunner
  };
})(globalThis);
