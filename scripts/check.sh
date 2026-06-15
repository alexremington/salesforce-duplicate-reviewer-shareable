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

echo "Checking closeout Beads regression..."
node scripts/check-closeout-beads.js

echo "Checking large JSON ingest strategy..."
node scripts/check-large-json-ingest.js

echo "Checking feature manifest..."
node ../automation-shared-resources/scripts/check-feature-manifest.js .

echo "Checking server contracts..."
node scripts/check-server-contracts.js

echo "Checking merge queue readiness helper..."
node scripts/check-merge-queue-readiness.js --self-check

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
prodContactsDryRun="$(scripts/run-prod-contacts-bulk-query.sh --dry-run)"
case "${prodContactsDryRun}" in
  *"/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts"*) ;;
  *)
    echo "${prodContactsDryRun}"
    echo "Prod Contacts did not resolve to the canonical Salesforce Pulls prod folder."
    exit 1
    ;;
esac
case "${prodContactsDryRun}" in
  *"Org alias: politico"*) ;;
  *)
    echo "${prodContactsDryRun}"
    echo "Prod Contacts did not use the canonical prod Salesforce org alias."
    exit 1
    ;;
esac
case "${prodContactsDryRun}" in
  *"Instance: https://login.salesforce.com"*) ;;
  *)
    echo "${prodContactsDryRun}"
    echo "Prod Contacts did not use the canonical prod Salesforce instance URL."
    exit 1
    ;;
esac
case "${prodContactsDryRun}" in
  *"SOQL file: ${PROJECT_DIR}/queries/report-00OVq00000CxYd3MAF.soql"*) ;;
  *)
    echo "${prodContactsDryRun}"
    echo "Prod Contacts did not use the canonical prod Contacts query file."
    exit 1
    ;;
esac
case "${prodContactsDryRun}" in
  *"Latest JSON: ${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/salesforce-prod-contacts-latest.json"*) ;;
  *)
    echo "${prodContactsDryRun}"
    echo "Prod Contacts did not preserve the canonical prod latest JSON output flow."
    exit 1
    ;;
esac
case "${prodContactsDryRun}" in
  *"Compatibility CSV: ${HOME}/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/salesforce-prod-contacts-latest.csv"*) ;;
  *)
    echo "${prodContactsDryRun}"
    echo "Prod Contacts did not preserve the canonical prod compatibility CSV output flow."
    exit 1
    ;;
esac
if ! grep -Fq "autoload=prod-contacts" scripts/run-prod-contacts-bulk-query.sh; then
  echo "Prod Contacts launcher did not open Duplicate Reviewer with the prod autoload URL."
  exit 1
fi
if ! grep -Fq "sf org auth show-access-token" scripts/run-salesforce-bulk-query.sh; then
  echo "Bulk query wrapper did not use sf org auth show-access-token."
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
if ! grep -Fq 'start-reviewer-server.sh" --force-refresh' scripts/run-staging-accounts-bulk-query.sh; then
  echo "Staging Accounts launcher did not force-refresh the reviewer server before opening the URL."
  exit 1
fi
if ! grep -Fq 'FORCE_REFRESH=0' scripts/start-reviewer-server.sh; then
  echo "Reviewer launcher did not add a force-refresh mode."
  exit 1
fi
if ! grep -Fq -- '--force-refresh' scripts/start-reviewer-server.sh; then
  echo "Reviewer launcher did not accept the force-refresh flag."
  exit 1
fi

if git rev-parse --verify shareable >/dev/null 2>&1; then
  echo "Checking shareable branch safety..."
  "${PROJECT_DIR}/scripts/check-shareable.sh" shareable
fi

echo "Checks passed."
