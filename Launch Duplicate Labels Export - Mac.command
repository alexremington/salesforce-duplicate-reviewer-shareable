#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cd "${PROJECT_DIR}"
exec /usr/bin/env node "${PROJECT_DIR}/scripts/run-salesforce-duplicate-label-export.js" "$@"
