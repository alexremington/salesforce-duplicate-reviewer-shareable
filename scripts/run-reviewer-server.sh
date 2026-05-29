#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/load-env.sh"
load_project_env "${PROJECT_DIR}/.env"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PORT="${DUPLICATE_REVIEWER_PORT:-${PORT:-5180}}"
export SF_USE_GENERIC_UNIX_KEYCHAIN="${SF_USE_GENERIC_UNIX_KEYCHAIN:-true}"
export SF_ORG_ALIAS="${SF_ORG_ALIAS:-politico-staging}"
export SF_INSTANCE_URL="${SF_INSTANCE_URL:-https://politico--staging.sandbox.my.salesforce.com}"
export SF_API_VERSION="${SF_API_VERSION:-v67.0}"

cd "${PROJECT_DIR}"
exec node server.js
