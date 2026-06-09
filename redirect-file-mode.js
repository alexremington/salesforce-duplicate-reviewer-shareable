(() => {
  const DEFAULT_SERVER_ORIGIN = "http://127.0.0.1:5180";
  const APP_ID = "salesforce-duplicate-reviewer";
  const HEALTH_TIMEOUT_MS = 900;

  if (window.location.protocol !== "file:") return;

  const params = new URLSearchParams(window.location.search);
  const serverOrigin = loopbackServerOrigin(params.get("server")) || DEFAULT_SERVER_ORIGIN;
  params.delete("server");

  const legacySource = params.get("source");
  if (legacySource && !params.has("autoload")) {
    params.set("autoload", legacySource);
  }
  params.delete("source");

  const query = params.toString();
  const targetUrl = `${serverOrigin}/${query ? `?${query}` : ""}${window.location.hash || ""}`;
  window.DUPLICATE_REVIEWER_FILE_MODE = { serverOrigin, targetUrl };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  fetch(`${serverOrigin}/api/health`, {
    cache: "no-store",
    signal: controller.signal
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((health) => {
      if (health?.appId === APP_ID) {
        window.location.replace(targetUrl);
      }
    })
    .catch(() => {})
    .finally(() => window.clearTimeout(timeout));

  function loopbackServerOrigin(value) {
    if (!value) return "";

    try {
      const url = new URL(value);
      const isLoopbackHost = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname);
      if (url.protocol !== "http:" || !isLoopbackHost || !url.port) return "";
      return url.origin;
    } catch {
      return "";
    }
  }
})();
