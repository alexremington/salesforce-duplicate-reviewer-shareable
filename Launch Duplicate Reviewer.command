#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
source "${PROJECT_DIR}/scripts/load-env.sh"
load_project_env "${PROJECT_DIR}/.env"

PORT="${DUPLICATE_REVIEWER_PORT:-${PORT:-5180}}"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PORT

cd "${PROJECT_DIR}"

start_output="$("${PROJECT_DIR}/scripts/start-reviewer-server.sh")"
echo "${start_output}"
URL="$(/usr/bin/printf '%s\n' "${start_output}" | /usr/bin/tail -n 1)"

echo "Opening ${URL}"
/usr/bin/open "${URL}"
