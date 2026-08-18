#!/usr/bin/env bash
# walras × Policywright demo — the S6 acceptance case.
#
# A REAL production tool (Policywright's `synthesize`, from its own repo) is
# served as a paid MCP tool behind walras and priced in testnet USDC. A
# generic MCP agent with ZERO prior integration boots the walras MCP server,
# searches for the capability (finds nothing — the catalog is settle-gated),
# pays the tool, and by paying it puts it in the catalog; a second search
# then finds it. Everything settles live on stellar:testnet.
#
# Provenance (walras session G6.2): the Policywright tool lives in the
# Policywright repo on branch `walras-x402-integration`
# (integrations/walras-x402). This script does not vendor it; point PW_REPO
# at a checkout of that branch, or place it at ../policywright.
#
# Requires: .env populated (scripts/setup-accounts.mjs + a USDC-funded buyer,
# e.g. scripts/testnet-usdc.mjs) and PW_PAYTO_ADDRESS set (the Policywright-
# owned payTo — integrations/walras-x402/setup-payto.mjs). pnpm install run
# in both repos.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\n== %s ==\n' "$*"; }
die()  { echo "policywright-demo: FAIL — $*" >&2; exit 1; }

PW_REPO="${PW_REPO:-$ROOT/../policywright}"
PW_INTEGRATION="$PW_REPO/integrations/walras-x402"

[ -f .env ] || die ".env missing. See scripts/setup-accounts.mjs."
[ -d "$PW_INTEGRATION" ] || die \
  "Policywright integration not found at $PW_INTEGRATION.
   Clone github.com/kunaldrall29/policywright, check out branch
   walras-x402-integration, run 'npm install' there, and set PW_REPO — or
   place the checkout at ../policywright."

# Same .env parser as scripts/demo.sh: Node's process.loadEnvFile.
eval "$(node -e '
  process.loadEnvFile(".env");
  const fs = require("fs");
  const keys = new Set();
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) keys.add(m[1]);
  }
  const q = String.fromCharCode(39);
  for (const k of keys) {
    const v = process.env[k];
    if (v === undefined) continue;
    console.log("export " + k + "=" + q + v.split(q).join(q + "\\" + q + q) + q);
  }
')" || die "could not parse .env"

require_strkey() { # name value prefix
  local name="$1" value="$2" prefix="$3"
  case "$value" in
    "$prefix"*) [ "${#value}" = 56 ] || die "$name is not a 56-char strkey (got ${#value} chars)";;
    *) die "$name does not start with $prefix — is .env still holding the .env.example placeholder?";;
  esac
}
require_strkey CLIENT_STELLAR_PRIVATE_KEY "${CLIENT_STELLAR_PRIVATE_KEY:-}" S
require_strkey FACILITATOR_STELLAR_PRIVATE_KEY "${FACILITATOR_STELLAR_PRIVATE_KEY:-}" S
require_strkey PW_PAYTO_ADDRESS "${PW_PAYTO_ADDRESS:-}" G

FAC_PORT="${PORT:-4021}"
PW_MCP_PORT="${PW_MCP_PORT:-4024}"
FAC="http://127.0.0.1:${FAC_PORT}"
PW_MCP_URL="http://127.0.0.1:${PW_MCP_PORT}/mcp"
HORIZON="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
TSX="./node_modules/.bin/tsx"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$ROOT/demo-logs/run-${STAMP}-policywright"
mkdir -p "$LOG_DIR"
DEMO_DB="$ROOT/data/policywright-demo-catalog.db"

say "walras × Policywright demo (logs: $LOG_DIR)"

http_code() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }

[ "$(http_code "$FAC/health")" = "000" ] || die "something is already on :$FAC_PORT — stop it or set PORT"
[ "$(http_code "$PW_MCP_URL")" = "000" ] || die "something is already on :$PW_MCP_PORT — stop it or set PW_MCP_PORT"

# The buyer needs USDC; the Policywright payTo needs a trustline to receive it.
node --input-type=module -e '
  import { Keypair } from "@stellar/stellar-sdk";
  const horizon = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  const buyer = Keypair.fromSecret(process.env.CLIENT_STELLAR_PRIVATE_KEY).publicKey();
  const payTo = process.env.PW_PAYTO_ADDRESS;
  const usdcOf = async (account) => {
    const res = await fetch(`${horizon}/accounts/${account}`);
    if (res.status !== 200) throw new Error(`${account}: Horizon ${res.status} — funded?`);
    const body = await res.json();
    return body.balances.find(b => b.asset_code === "USDC")?.balance ?? null;
  };
  const buyerUsdc = await usdcOf(buyer);
  if (buyerUsdc === null || Number(buyerUsdc) < 0.2)
    throw new Error(`buyer ${buyer} needs testnet USDC (have: ${buyerUsdc ?? "no trustline"}). scripts/testnet-usdc.mjs`);
  if ((await usdcOf(payTo)) === null)
    throw new Error(`payTo ${payTo} has no USDC trustline — integrations/walras-x402/setup-payto.mjs`);
  console.log(`buyer ${buyer} holds ${buyerUsdc} USDC — ok`);
' || die "account preflight failed (see message above)"

say "building walras packages"
pnpm -s build >"$LOG_DIR/build.log" 2>&1 || die "walras build failed — see $LOG_DIR/build.log"

PIDS=()
cleanup() {
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

say "booting walras facilitator on :$FAC_PORT (fresh catalog: $DEMO_DB)"
rm -f "$DEMO_DB" "$DEMO_DB-wal" "$DEMO_DB-shm"
DB_PATH="$DEMO_DB" PORT="$FAC_PORT" node packages/facilitator/dist/index.js \
  >"$LOG_DIR/facilitator.log" 2>&1 &
PIDS+=($!)
for i in $(seq 1 60); do
  [ "$(http_code "$FAC/health")" = "200" ] && break
  sleep 0.5
done
[ "$(http_code "$FAC/health")" = "200" ] || die "facilitator did not become ready — see $LOG_DIR/facilitator.log"

say "booting the Policywright paid MCP tool on :$PW_MCP_PORT (from $PW_INTEGRATION)"
( cd "$PW_INTEGRATION" && \
    FACILITATOR_URL="$FAC" PW_MCP_PORT="$PW_MCP_PORT" PW_PAYTO_ADDRESS="$PW_PAYTO_ADDRESS" \
    ./node_modules/.bin/tsx server.ts ) >"$LOG_DIR/pw-seller.log" 2>&1 &
PIDS+=($!)
# Stateless streamable-HTTP: any HTTP answer (405/406/400) means it is up.
for i in $(seq 1 60); do
  code="$(http_code "$PW_MCP_URL")"
  [ "$code" != "000" ] && break
  sleep 0.5
done
[ "$code" != "000" ] || die "Policywright seller did not come up — see $LOG_DIR/pw-seller.log"
echo "Policywright tool answering on $PW_MCP_URL (HTTP $code to a bare GET)"

say "agent session — zero prior integration (demo/policywright-session.ts)"
( cd demo && FACILITATOR_URL="$FAC" HORIZON_URL="$HORIZON" PW_MCP_URL="$PW_MCP_URL" \
    "$TSX" policywright-session.ts ) | tee "$LOG_DIR/policywright-session.log" \
  || die "agent session failed — see $LOG_DIR/policywright-session.log"

say "PASS"
echo "transcript: $LOG_DIR/policywright-session.log"
