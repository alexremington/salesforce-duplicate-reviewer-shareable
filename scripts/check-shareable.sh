#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BRANCH="${1:-shareable}"

cd "${PROJECT_DIR}"

if ! git rev-parse --verify "${BRANCH}" >/dev/null 2>&1; then
  echo "Missing branch or ref: ${BRANCH}" >&2
  exit 2
fi

echo "Checking shareable sanitized projection..."
node "${PROJECT_DIR}/scripts/sync-shareable-sanitized.js" --check --source-ref main --target-ref "${BRANCH}"

PRIVATE_PATTERN='00OV|00OS|OneDrive-POLITICO|/Users|politico--staging|politico-staging|politico\.my\.salesforce|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
GENERATED_PATTERN='(^|/)(Output|logs|incoming|backups|data|dist|node_modules|\.beads)(/|$)|(^|/)\.DS_Store$'

# Beads stores local workspace metadata and backup state, not shareable app code.
if git grep -n -E "${PRIVATE_PATTERN}" "${BRANCH}" -- . ':(exclude)scripts/check-shareable.sh' ':(exclude).beads' ':(exclude).beads/**'; then
  echo "Potential private detail found in ${BRANCH}." >&2
  exit 1
fi

if git ls-tree -r --name-only "${BRANCH}" | /usr/bin/grep -vE '^\.beads(/|$)' | /usr/bin/grep -E "${GENERATED_PATTERN}"; then
  echo "Generated/runtime files found in ${BRANCH}." >&2
  exit 1
fi

echo "Shareable branch scan passed: ${BRANCH}"
