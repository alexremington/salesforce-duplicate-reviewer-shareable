#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_DIR}"

echo "Checking JavaScript syntax..."
node ../automation-shared-resources/scripts/check-js-syntax.js . \
  --exclude Output \
  --exclude incoming \
  --exclude logs \
  --exclude node_modules

echo "Checking shell syntax..."
find . \
  -path './.git' -prune -o \
  -path './Output' -prune -o \
  -path './incoming' -prune -o \
  -path './logs' -prune -o \
  -path './node_modules' -prune -o \
  -type f \( -name '*.sh' -o -name '*.command' \) -exec zsh -n {} \;

echo "Checking package metadata..."
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))'

echo "Checking feature manifest..."
node ../automation-shared-resources/scripts/check-feature-manifest.js .

echo "Checking server contracts..."
node scripts/check-server-contracts.js

echo "Checking staging routing defaults..."
contactsDryRun="$(scripts/run-staging-contacts-bulk-query.sh --dry-run)"
case "${contactsDryRun}" in
  *"/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts"*) ;;
  *)
    echo "${contactsDryRun}"
    echo "Staging Contacts did not resolve to the canonical Salesforce Pulls staging folder."
    exit 1
    ;;
esac
case "${contactsDryRun}" in
  *"Bulk poll interval ms: 5000"*) ;;
  *)
    echo "${contactsDryRun}"
    echo "Staging Contacts bulk polling was not pinned to the faster handoff interval."
    exit 1
    ;;
esac
case "${contactsDryRun}" in
  *"Latest JSON: ${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts/salesforce-report-latest.json"*) ;;
  *)
    echo "${contactsDryRun}"
    echo "Staging Contacts did not preserve the canonical latest JSON output flow."
    exit 1
    ;;
esac
case "${contactsDryRun}" in
  *"Compatibility CSV: ${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts/salesforce-report-latest.csv"*) ;;
  *)
    echo "${contactsDryRun}"
    echo "Staging Contacts did not preserve the canonical compatibility CSV output flow."
    exit 1
    ;;
esac
if ! grep -Fq "sf org auth show-access-token" scripts/run-salesforce-bulk-query.sh; then
  echo "Bulk query wrapper did not use sf org auth show-access-token."
  exit 1
fi
accountsDryRun="$(scripts/run-staging-accounts-bulk-query.sh --dry-run)"
case "${accountsDryRun}" in
  *"/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts"*) ;;
  *)
    echo "${accountsDryRun}"
    echo "Staging Accounts did not resolve to the canonical Salesforce Pulls staging folder."
    exit 1
    ;;
esac
case "${accountsDryRun}" in
  *"Bulk poll interval ms: 5000"*) ;;
  *)
    echo "${accountsDryRun}"
    echo "Staging Accounts bulk polling was not pinned to the faster handoff interval."
    exit 1
    ;;
esac
case "${accountsDryRun}" in
  *"Latest JSON: ${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts/salesforce-report-latest.json"*) ;;
  *)
    echo "${accountsDryRun}"
    echo "Staging Accounts did not preserve the canonical latest JSON output flow."
    exit 1
    ;;
esac
case "${accountsDryRun}" in
  *"Compatibility CSV: ${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts/salesforce-report-latest.csv"*) ;;
  *)
    echo "${accountsDryRun}"
    echo "Staging Accounts did not preserve the canonical compatibility CSV output flow."
    exit 1
    ;;
esac

if git rev-parse --verify shareable >/dev/null 2>&1; then
  echo "Checking shareable branch safety..."
  "${PROJECT_DIR}/scripts/check-shareable.sh" shareable
fi

echo "Checks passed."
