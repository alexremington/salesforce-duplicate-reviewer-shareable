#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
source "${PROJECT_DIR}/scripts/load-env.sh"
load_project_env "${PROJECT_DIR}/.env"

PORT="${DUPLICATE_REVIEWER_PORT:-${PORT:-5180}}"
URL="http://127.0.0.1:${PORT}"
LOG_DIR="${PROJECT_DIR}/logs"
OUT_LOG="${LOG_DIR}/duplicate-reviewer.out.log"
ERR_LOG="${LOG_DIR}/duplicate-reviewer.err.log"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PORT

mkdir -p "${LOG_DIR}"
cd "${PROJECT_DIR}"

if ! /usr/sbin/lsof -iTCP:"${PORT}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "Starting Salesforce Duplicate Reviewer..."
  nohup npm start >>"${OUT_LOG}" 2>>"${ERR_LOG}" &
else
  echo "Salesforce Duplicate Reviewer is already running."
fi

echo "Waiting for ${URL}..."
for attempt in {1..40}; do
  if /usr/bin/curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
    echo "Opening ${URL}"
    /usr/bin/open "${URL}"
    exit 0
  fi

  sleep 0.25
done

echo "The duplicate reviewer did not become ready in time."
echo "Stdout log: ${OUT_LOG}"
echo "Stderr log: ${ERR_LOG}"
exit 1
