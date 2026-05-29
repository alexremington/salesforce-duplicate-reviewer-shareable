#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${DUPLICATE_REVIEWER_PORT:-5180}"
URL="http://127.0.0.1:${PORT}"
LOG_DIR="${HOME}/Library/Logs/salesforce-duplicate-reviewer"
OUT_LOG="${LOG_DIR}/duplicate-reviewer-server.out.log"
ERR_LOG="${LOG_DIR}/duplicate-reviewer-server.err.log"
STATIC_DIR="${DUPLICATE_REVIEWER_STATIC_DIR:-${HOME}/Library/Application Support/salesforce-duplicate-reviewer/static}"
LABEL="com.salesforce-duplicate-reviewer.server"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
USER_DOMAIN="gui/$(/usr/bin/id -u)"
SERVICE_TARGET="${USER_DOMAIN}/${LABEL}"
SERVER_SCRIPT="${PROJECT_DIR}/scripts/run-reviewer-server.sh"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "${LOG_DIR}"

server_pid() {
  /usr/sbin/lsof -tiTCP:"${PORT}" -sTCP:LISTEN -n -P 2>/dev/null | /usr/bin/awk 'NR == 1 { print; exit }' || true
}

server_health() {
  /usr/bin/curl -fsS "${URL}/api/health" 2>/dev/null || true
}

server_is_duplicate_reviewer() {
  local health
  health="$(server_health)"
  [[ "${health}" == *'"appId":"salesforce-duplicate-reviewer"'* || "${health}" == *'"salesforceMerge":true'* ]]
}

server_supports_required_features() {
  local health
  health="$(server_health)"
  [[ "${health}" == *'"salesforceMerge":true'* && "${health}" == *'"latestStagingFiles":true'* && "${health}" == *'"jsonDatasets":true'* ]]
}

write_server_plist() {
  /bin/mkdir -p "$(/usr/bin/dirname "${PLIST_PATH}")" "${LOG_DIR}" "${STATIC_DIR}"
  /bin/cat >"${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${SERVER_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>DUPLICATE_REVIEWER_PORT</key>
    <string>${PORT}</string>
    <key>DUPLICATE_REVIEWER_STATIC_DIR</key>
    <string>${STATIC_DIR}</string>
    <key>SF_USE_GENERIC_UNIX_KEYCHAIN</key>
    <string>true</string>
    <key>SF_ORG_ALIAS</key>
    <string>${SF_ORG_ALIAS:-politico-staging}</string>
    <key>SF_INSTANCE_URL</key>
    <string>${SF_INSTANCE_URL:-https://politico--staging.sandbox.my.salesforce.com}</string>
    <key>SF_API_VERSION</key>
    <string>${SF_API_VERSION:-v67.0}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
</dict>
</plist>
PLIST
  /usr/bin/plutil -lint "${PLIST_PATH}" >/dev/null
}

sync_static_assets() {
  /bin/mkdir -p "${STATIC_DIR}"
  copy_static_asset "${PROJECT_DIR}/index.html" "${STATIC_DIR}/index.html"
  copy_static_asset "${PROJECT_DIR}/redirect-file-mode.js" "${STATIC_DIR}/redirect-file-mode.js"
  copy_static_asset "${PROJECT_DIR}/app.js" "${STATIC_DIR}/app.js"
  copy_static_asset "${PROJECT_DIR}/matching-worker.js" "${STATIC_DIR}/matching-worker.js"
  copy_static_asset "${PROJECT_DIR}/styles.css" "${STATIC_DIR}/styles.css"
  /bin/mkdir -p "${STATIC_DIR}/assets"
  copy_static_asset "${PROJECT_DIR}/assets/politico-logo.svg" "${STATIC_DIR}/assets/politico-logo.svg"
  /bin/mkdir -p "${STATIC_DIR}/vendor/managed-app/css"
  /bin/mkdir -p "${STATIC_DIR}/vendor/managed-app/scripts"
  copy_static_asset "${PROJECT_DIR}/vendor/managed-app/css/managed-app-base.css" "${STATIC_DIR}/vendor/managed-app/css/managed-app-base.css"
  copy_static_asset "${PROJECT_DIR}/vendor/managed-app/scripts/managed-worker-client.js" "${STATIC_DIR}/vendor/managed-app/scripts/managed-worker-client.js"
}

copy_static_asset() {
  local source="$1"
  local target="$2"
  local temp="${target}.$$"
  if /usr/bin/perl -0777 -ne 'print' "${source}" >"${temp}"; then
    /bin/mv "${temp}" "${target}"
    return
  fi

  /bin/rm -f "${temp}"
  if [[ -f "${target}" ]]; then
    echo "Warning: could not refresh ${target}; keeping existing cached copy." >&2
    return
  fi

  echo "Missing static asset and no cached copy is available: ${source}" >&2
  return 1
}

start_server_agent() {
  write_server_plist

  if /bin/launchctl print "${SERVICE_TARGET}" >/dev/null 2>&1; then
    /bin/launchctl bootout "${SERVICE_TARGET}" >/dev/null 2>&1 || true
  fi
  /bin/launchctl bootstrap "${USER_DOMAIN}" "${PLIST_PATH}" >/dev/null
}

pid="$(server_pid)"
sync_static_assets
if [[ -n "${pid}" ]] && ! server_is_duplicate_reviewer; then
  echo "Port ${PORT} is already in use by a different local process. Stop that process or set DUPLICATE_REVIEWER_PORT in .env." >&2
  exit 1
fi

if [[ -n "${pid}" ]] && ! server_supports_required_features; then
  echo "Restarting Salesforce Duplicate Reviewer server at ${URL} to enable current features"
  /bin/launchctl bootout "${SERVICE_TARGET}" >/dev/null 2>&1 || true
  /bin/kill "${pid}" >/dev/null 2>&1 || true
  for attempt in {1..40}; do
    if [[ -z "$(server_pid)" ]]; then
      break
    fi
    sleep 0.25
  done
fi

if [[ -z "$(server_pid)" ]]; then
  echo "Starting Salesforce Duplicate Reviewer server at ${URL} via ${LABEL}"
  start_server_agent
else
  echo "Salesforce Duplicate Reviewer server is already running at ${URL}"
fi

for attempt in {1..80}; do
  if /usr/bin/curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
    echo "${URL}"
    exit 0
  fi
  sleep 0.25
done

echo "Salesforce Duplicate Reviewer server did not become ready in time." >&2
echo "Stdout log: ${OUT_LOG}" >&2
echo "Stderr log: ${ERR_LOG}" >&2
exit 1
