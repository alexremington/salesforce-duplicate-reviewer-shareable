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
  *"/Output/staging-contacts"*) ;;
  *)
    echo "${contactsDryRun}"
    echo "Staging Contacts did not resolve to the public-safe staging output folder."
    exit 1
    ;;
esac
if ! grep -Fq "sf org display" scripts/run-salesforce-bulk-query.sh; then
  echo "Bulk query wrapper did not use sf org display."
  exit 1
fi
labelsDryRun="$(node scripts/run-salesforce-duplicate-label-export.js --object contact --dry-run)"
shareableStagingRoot="${HOME}/Salesforce Pulls/Duplicate Reviewer/staging"
case "${labelsDryRun}" in
  *"SOQL file: ${PROJECT_DIR}/queries/contact-duplicate-record-items.soql"*) ;;
  *)
    echo "${labelsDryRun}"
    echo "Duplicate labels export did not resolve the canonical contact duplicate-items query."
    exit 1
    ;;
esac
case "${labelsDryRun}" in
  *"Source CSV: ${shareableStagingRoot}/Output/staging-contacts/salesforce-report-latest.csv"*) ;;
  *)
    echo "${labelsDryRun}"
    echo "Duplicate labels export did not default to the canonical staging Contacts CSV."
    exit 1
    ;;
esac
accountsDryRun="$(scripts/run-staging-accounts-bulk-query.sh --dry-run)"
case "${accountsDryRun}" in
  *"/Output/staging-accounts"*) ;;
  *)
    echo "${accountsDryRun}"
    echo "Staging Accounts did not resolve to the public-safe staging output folder."
    exit 1
    ;;
esac

if git rev-parse --verify shareable >/dev/null 2>&1; then
  echo "Checking shareable branch safety..."
  "${PROJECT_DIR}/scripts/check-shareable.sh" shareable
fi

echo "Checks passed."
