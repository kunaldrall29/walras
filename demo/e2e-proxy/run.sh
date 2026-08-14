#!/bin/bash
# Runs the walras facilitator (built dist, unmodified) as an e2e facilitator.
# Maps the e2e harness env contract onto walras's own variables:
#   STELLAR_PRIVATE_KEY -> SUBMITTER_SECRET
#   STELLAR_NETWORK     -> NETWORK   (default stellar:testnet)
#   STELLAR_RPC_URL     -> RPC_URL
#   PORT                -> PORT      (passed through)
#
# The repo root is resolved from this script's own location, so the proxy works
# from any checkout path. Override with WALRAS_ROOT if the harness copies these
# scripts somewhere else.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WALRAS_ROOT="${WALRAS_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENTRY="$WALRAS_ROOT/packages/facilitator/dist/index.js"

if [ ! -f "$ENTRY" ]; then
  echo "walras dist not found at $ENTRY — run build.sh first (or set WALRAS_ROOT)" >&2
  exit 1
fi

export SUBMITTER_SECRET="${STELLAR_PRIVATE_KEY:?STELLAR_PRIVATE_KEY is required}"
export NETWORK="${STELLAR_NETWORK:-stellar:testnet}"
export RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
export PORT="${PORT:?PORT is required}"

# The harness treats this line as the readiness signal; /health is polled after.
echo "Facilitator listening on port ${PORT} (walras)"
exec node "$ENTRY"
