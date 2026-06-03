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

if git rev-parse --verify shareable >/dev/null 2>&1; then
  echo "Checking shareable branch safety..."
  "${PROJECT_DIR}/scripts/check-shareable.sh" shareable
fi

echo "Checks passed."
