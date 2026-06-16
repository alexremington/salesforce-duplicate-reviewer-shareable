#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/load-env.sh"
load_project_env "${PROJECT_DIR}/.env"

export SF_USE_GENERIC_UNIX_KEYCHAIN="${SF_USE_GENERIC_UNIX_KEYCHAIN:-true}"
export SF_ORG_ALIAS="${SF_ORG_ALIAS:-politico}"
export SF_INSTANCE_URL="${SF_INSTANCE_URL:-https://login.salesforce.com}"
export SF_API_VERSION="${SF_API_VERSION:-v67.0}"
export SF_REPORT_ID="${SF_REPORT_ID:-00OVq00000CxYd3MAF}"
export SF_SOQL_FILE="${SF_SOQL_FILE:-${PROJECT_DIR}/queries/report-${SF_REPORT_ID}.soql}"
export DUPLICATE_REVIEWER_PROD_ROOT="${DUPLICATE_REVIEWER_PROD_ROOT:-${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/prod}"
export OUT_DIR="${OUT_DIR:-${DUPLICATE_REVIEWER_PROD_ROOT}/Output/prod-contacts}"
export LATEST_CSV_NAME="${LATEST_CSV_NAME:-salesforce-prod-contacts-latest.csv}"
export LATEST_JSON_NAME="${LATEST_JSON_NAME:-salesforce-prod-contacts-latest.json}"
export BULK_POLL_MS="${BULK_POLL_MS:-5000}"
export PROD_CONTACTS_CSV="${PROD_CONTACTS_CSV:-${DUPLICATE_REVIEWER_PROD_ROOT}/Output/prod-contacts/salesforce-prod-contacts-latest.csv}"

if [[ "${1:-}" == "--background" ]]; then
  shift
  mkdir -p "${PROJECT_DIR}/logs"
  /usr/bin/nohup "${PROJECT_DIR}/scripts/run-prod-contacts-bulk-query.sh" "$@" \
    >>"${PROJECT_DIR}/logs/download-prod-contacts.out.log" \
    2>>"${PROJECT_DIR}/logs/download-prod-contacts.err.log" &
  echo "Started prod Contacts duplicate review flow in the background with PID $!."
  echo "Stdout log: ${PROJECT_DIR}/logs/download-prod-contacts.out.log"
  echo "Stderr log: ${PROJECT_DIR}/logs/download-prod-contacts.err.log"
  exit 0
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  exec "${PROJECT_DIR}/scripts/run-salesforce-bulk-query.sh" "$@"
fi

node "${PROJECT_DIR}/scripts/prod-contacts-output-repair.js"

notify_failure() {
  /usr/bin/osascript -e 'display notification "The prod Contacts export failed. Check the job logs." with title "Duplicate Reviewer"' >/dev/null 2>&1 || true
}

if ! "${PROJECT_DIR}/scripts/run-salesforce-bulk-query.sh" "$@"; then
  notify_failure
  exit 1
fi

reviewer_url="$("${PROJECT_DIR}/scripts/start-reviewer-server.sh" | tail -n 1)"
autoload_url="${reviewer_url}/?autoload=prod-contacts&object=contact&notify=1&sticky=1&name=${LATEST_JSON_NAME}"

/usr/bin/open "${autoload_url}"
echo "Opened Salesforce Duplicate Reviewer at ${autoload_url}"
echo "The app will show a Notification Center alert after the latest prod JSON dataset is loaded and ready to review."
