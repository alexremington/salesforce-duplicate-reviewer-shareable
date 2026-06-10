#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
LABEL="com.salesforce-duplicate-reviewer.server"
USER_DOMAIN="gui/$(/usr/bin/id -u)"
SERVICE_TARGET="${USER_DOMAIN}/${LABEL}"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if /bin/launchctl print "${SERVICE_TARGET}" >/dev/null 2>&1; then
  /bin/launchctl bootout "${SERVICE_TARGET}" >/dev/null 2>&1 || true
fi

exec /usr/bin/env node "${PROJECT_DIR}/scripts/launch-local-app.js"
