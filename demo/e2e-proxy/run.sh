#!/bin/bash
# Runs the walras facilitator (built dist, unmodified) as an e2e facilitator.
# Maps the e2e harness env contract onto walras's own variables:
#   STELLAR_PRIVATE_KEY -> SUBMITTER_SECRET
#   STELLAR_NETWORK     -> NETWORK   (default stellar:testnet)
#   STELLAR_RPC_URL     -> RPC_URL
#   PORT                -> PORT      (passed through)
set -euo pipefail

export SUBMITTER_SECRET="${STELLAR_PRIVATE_KEY:?STELLAR_PRIVATE_KEY is required}"
export NETWORK="${STELLAR_NETWORK:-stellar:testnet}"
export RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
export PORT="${PORT:?PORT is required}"

# The harness treats this line as the readiness signal; /health is polled after.
echo "Facilitator listening on port ${PORT} (walras)"
exec node /workspaces/walras/packages/facilitator/dist/index.js
