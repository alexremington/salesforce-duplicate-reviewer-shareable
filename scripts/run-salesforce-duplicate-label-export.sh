#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
exec /usr/bin/env node "${PROJECT_DIR}/scripts/run-salesforce-duplicate-label-export.js" "$@"
