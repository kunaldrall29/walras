#!/bin/bash
# Builds the walras facilitator dist the e2e harness runs. The repo root is
# resolved from this script's own location (override with WALRAS_ROOT), so the
# 4/4 e2e result (EVIDENCE S2-4) is reproducible from any checkout path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WALRAS_ROOT="${WALRAS_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

cd "$WALRAS_ROOT"
pnpm build
