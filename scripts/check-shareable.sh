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

PRIVATE_PATTERN='00O[A-Za-z0-9]{12,15}|00D[A-Za-z0-9]{12,15}|/Users/|[A-Za-z]:\\Users\\|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
GENERATED_PATTERN='(^|/)(Output|logs|incoming|backups|data|dist|node_modules)(/|$)|(^|/)\.DS_Store$'

if git grep -n -E "${PRIVATE_PATTERN}" "${BRANCH}" -- . ':(exclude)scripts/check-shareable.sh'; then
  echo "Potential private detail found in ${BRANCH}." >&2
  exit 1
fi

if git ls-tree -r --name-only "${BRANCH}" | /usr/bin/grep -E "${GENERATED_PATTERN}"; then
  echo "Generated/runtime files found in ${BRANCH}." >&2
  exit 1
fi

echo "Shareable branch scan passed: ${BRANCH}"
