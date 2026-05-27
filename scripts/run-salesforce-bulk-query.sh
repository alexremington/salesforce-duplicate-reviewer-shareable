#!/bin/zsh
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SF_USE_GENERIC_UNIX_KEYCHAIN="${SF_USE_GENERIC_UNIX_KEYCHAIN:-true}"

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ORG_ALIAS="${SF_ORG_ALIAS:-politico}"
INSTANCE_URL="${SF_INSTANCE_URL:-https://politico.my.salesforce.com}"
API_VERSION="${SF_API_VERSION:-v64.0}"
REPORT_ID="${SF_REPORT_ID:-00OVq00000CxYd3MAF}"
SOQL_FILE="${SF_SOQL_FILE:-${PROJECT_DIR}/queries/report-${REPORT_ID}.soql}"
OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/Output/report-${REPORT_ID}}"
LATEST_CSV_NAME="${LATEST_CSV_NAME:-salesforce-report-latest.csv}"
LATEST_JSON_NAME="${LATEST_JSON_NAME:-salesforce-report-latest.json}"
BULK_POLL_MS="${BULK_POLL_MS:-15000}"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Project: ${PROJECT_DIR}"
  echo "Output: ${OUT_DIR}"
  echo "Org alias: ${ORG_ALIAS}"
  echo "Instance: ${INSTANCE_URL}"
  echo "API version: ${API_VERSION}"
  echo "Report metadata source: ${REPORT_ID}"
  echo "SOQL file: ${SOQL_FILE}"
  echo "Fetch mode: Bulk API CSV transport with JSON latest output"
  echo "Latest JSON: ${OUT_DIR}/${LATEST_JSON_NAME}"
  echo "Compatibility CSV: ${OUT_DIR}/${LATEST_CSV_NAME}"
  echo "Bulk poll interval ms: ${BULK_POLL_MS}"
  exit 0
fi

if [[ ! -f "${SOQL_FILE}" ]]; then
  echo "Missing SOQL file: ${SOQL_FILE}" >&2
  echo "Bulk API cannot run a report ID directly. Create this file with the SOQL equivalent of report ${REPORT_ID}." >&2
  echo "Start by fetching report metadata, then translate its columns and filters into SOQL." >&2
  exit 2
fi

mkdir -p "${OUT_DIR}" "${PROJECT_DIR}/logs"

timestamp="$(date +%Y%m%d-%H%M%S)"
output_file="${OUT_DIR}/salesforce-report-${REPORT_ID}-${timestamp}.csv"
json_output_file="${OUT_DIR}/salesforce-report-${REPORT_ID}-${timestamp}.json"
latest_file="${OUT_DIR}/${LATEST_CSV_NAME}"
latest_json_file="${OUT_DIR}/${LATEST_JSON_NAME}"

access_token="$(
  env -u SF_API_VERSION sf org display --target-org "${ORG_ALIAS}" --json \
    | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const result = JSON.parse(s).result || {}; if (!result.accessToken) process.exit(2); process.stdout.write(result.accessToken); });'
)"

SF_ACCESS_TOKEN="${access_token}" \
  node "${PROJECT_DIR}/scripts/fetch-salesforce-bulk-query.js" \
    --instance "${INSTANCE_URL}" \
    --api-version "${API_VERSION}" \
    --query-file "${SOQL_FILE}" \
    --out "${output_file}" \
    --poll-ms "${BULK_POLL_MS}"

node "${PROJECT_DIR}/scripts/csv-to-salesforce-json.js" \
  --input "${output_file}" \
  --output "${json_output_file}"

cp "${output_file}" "${latest_file}"
cp "${json_output_file}" "${latest_json_file}"
echo "Saved Salesforce bulk export to ${output_file}"
echo "Saved Salesforce JSON export to ${json_output_file}"
echo "Updated latest JSON copy at ${latest_json_file}"
echo "Updated compatibility CSV copy at ${latest_file}"
