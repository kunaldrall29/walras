#!/bin/bash
# Installs walras's dependencies so the e2e harness can run the facilitator from
# a fresh checkout. The repo root is resolved from this script's own location
# (override with WALRAS_ROOT). A no-op if node_modules is already present.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WALRAS_ROOT="${WALRAS_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

if [ -d "$WALRAS_ROOT/node_modules" ]; then
  echo "walras dependencies already installed at $WALRAS_ROOT"
  exit 0
fi

cd "$WALRAS_ROOT"
pnpm install --frozen-lockfile
