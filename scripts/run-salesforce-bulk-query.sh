#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Preflight uses sf org auth show-access-token before the Salesforce pull starts.
exec node "${PROJECT_DIR}/scripts/run-salesforce-bulk-query.js" "$@"
