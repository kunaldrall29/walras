#!/usr/bin/env bash
# walras MCP demo — Session 6.
#
# Boots the facilitator (fresh catalog), the stock HTTP seller, and a paid
# MCP tool seller (stock @x402/mcp createPaymentWrapper), seeds the catalog
# with real settlements on stellar:testnet, then runs demo/mcp-session.ts —
# a GENERIC MCP client with zero walras imports that completes discover→pay
# using only the two MCP tools (search_resources, paid_call), including
# paying an MCP tool whose very settlement auto-catalogs it.
#
# Requires: .env populated (scripts/setup-accounts.mjs + faucet.circle.com),
# pnpm install already run. Everything else is orchestrated here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\n== %s ==\n' "$*"; }
die()  { echo "mcp-demo: FAIL — $*" >&2; exit 1; }

[ -f .env ] || die ".env missing. Run: cp .env.example .env, then node scripts/setup-accounts.mjs and paste its fragment in."
# Same .env parser as scripts/demo.sh: Node's process.loadEnvFile, so the
# demo can never disagree with the facilitator about what .env means.
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
require_strkey SERVER_STELLAR_ADDRESS "${SERVER_STELLAR_ADDRESS:-}" G
require_strkey FACILITATOR_STELLAR_PRIVATE_KEY "${FACILITATOR_STELLAR_PRIVATE_KEY:-}" S

FAC_PORT="${PORT:-4021}"
SELLER_PORT="${SELLER_PORT:-4022}"
MCP_SELLER_PORT="${MCP_SELLER_PORT:-4023}"
FAC="http://127.0.0.1:${FAC_PORT}"
SELLER="http://127.0.0.1:${SELLER_PORT}"
MCP_SELLER_URL="http://127.0.0.1:${MCP_SELLER_PORT}/mcp"
HORIZON="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
TSX="./node_modules/.bin/tsx"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$ROOT/demo-logs/run-${STAMP}-mcp"
mkdir -p "$LOG_DIR"
DEMO_DB="$ROOT/data/mcp-demo-catalog.db"

say "walras MCP demo (logs: $LOG_DIR)"

http_code() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }

[ "$(http_code "$FAC/health")" = "000" ] || die "something is already listening on :$FAC_PORT — stop it or set PORT"
[ "$(http_code "$SELLER/weather")" = "000" ] || die "something is already listening on :$SELLER_PORT — stop it or set SELLER_PORT"
[ "$(http_code "$MCP_SELLER_URL")" = "000" ] || die "something is already listening on :$MCP_SELLER_PORT — stop it or set MCP_SELLER_PORT"

# Balance/trustline preflight — this demo settles five real payments.
node --input-type=module -e '
  import { Keypair } from "@stellar/stellar-sdk";
  const horizon = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  const buyer = Keypair.fromSecret(process.env.CLIENT_STELLAR_PRIVATE_KEY).publicKey();
  const seller = process.env.SERVER_STELLAR_ADDRESS;
  const usdcOf = async (account) => {
    const res = await fetch(`${horizon}/accounts/${account}`);
    if (res.status !== 200) throw new Error(`${account}: Horizon ${res.status} — account not found/funded?`);
    const body = await res.json();
    return body.balances.find(b => b.asset_code === "USDC")?.balance ?? null;
  };
  const buyerUsdc = await usdcOf(buyer);
  if (buyerUsdc === null || Number(buyerUsdc) < 0.2)
    throw new Error(`buyer ${buyer} needs testnet USDC (have: ${buyerUsdc ?? "no trustline"}). Fund at faucet.circle.com (select Stellar).`);
  if ((await usdcOf(seller)) === null)
    throw new Error(`seller ${seller} has no USDC trustline — run node scripts/setup-accounts.mjs`);
  console.log(`buyer ${buyer} holds ${buyerUsdc} USDC — ok`);
' || die "account preflight failed (see message above)"

say "building packages"
pnpm -s build >"$LOG_DIR/build.log" 2>&1 || die "build failed — see $LOG_DIR/build.log"

PIDS=()
cleanup() {
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

wait_http() { # url expected_code label
  local url="$1" want="$2" label="$3" code="" i
  for i in $(seq 1 60); do
    code="$(http_code "$url")"
    [ "$code" = "$want" ] && return 0
    sleep 0.5
  done
  die "$label did not become ready (wanted HTTP $want from $url, last got $code) — see $LOG_DIR"
}

say "booting walras facilitator on :$FAC_PORT (fresh catalog: $DEMO_DB)"
rm -f "$DEMO_DB" "$DEMO_DB-wal" "$DEMO_DB-shm"
DB_PATH="$DEMO_DB" PORT="$FAC_PORT" node packages/facilitator/dist/index.js \
  >"$LOG_DIR/facilitator.log" 2>&1 &
PIDS+=($!)
wait_http "$FAC/health" 200 "facilitator"

say "booting stock @x402/express seller on :$SELLER_PORT"
( cd demo && FACILITATOR_URL="$FAC" SELLER_PORT="$SELLER_PORT" "$TSX" seller.ts ) \
  >"$LOG_DIR/seller.log" 2>&1 &
PIDS+=($!)
wait_http "$SELLER/weather" 402 "seller"

say "booting paid MCP tool seller (@x402/mcp createPaymentWrapper) on :$MCP_SELLER_PORT"
( cd demo && FACILITATOR_URL="$FAC" MCP_SELLER_PORT="$MCP_SELLER_PORT" "$TSX" mcp-seller.ts ) \
  >"$LOG_DIR/mcp-seller.log" 2>&1 &
PIDS+=($!)
# Stateless endpoint: any HTTP answer (405/406/400) means the port is up.
for i in $(seq 1 60); do
  code="$(http_code "$MCP_SELLER_URL")"
  [ "$code" != "000" ] && break
  sleep 0.5
done
[ "$code" != "000" ] || die "mcp-seller did not come up — see $LOG_DIR/mcp-seller.log"
echo "mcp-seller answering on $MCP_SELLER_URL (HTTP $code to a bare GET — expected for stateless streamable HTTP)"

say "seeding the catalog with real settlements (4 corpus routes)"
( cd demo && SEED_IDS="weather-current,weather-history,fx-rates,crypto-price" \
    SELLER_ORIGIN="$SELLER" "$TSX" seed-catalog.ts ) | tee "$LOG_DIR/seed.log"

say "MCP client session — zero pre-baked integration (demo/mcp-session.ts)"
( cd demo && FACILITATOR_URL="$FAC" HORIZON_URL="$HORIZON" MCP_SELLER_URL="$MCP_SELLER_URL" \
    "$TSX" mcp-session.ts ) | tee "$LOG_DIR/mcp-session.log" \
  || die "MCP session failed — see $LOG_DIR/mcp-session.log"

say "PASS"
echo "transcript: $LOG_DIR/mcp-session.log"
