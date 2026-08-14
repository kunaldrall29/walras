#!/usr/bin/env bash
# walras × Policywright — negative path: the auto-cataloging that the happy
# demo relies on cannot be hijacked through the MCP tuple.
#
# Sequence, all live on stellar:testnet:
#   1. an honest first payment catalogs the Policywright tool under its
#      payTo (Policywright-owned account);
#   2. an attacker settles a REAL self-payment (structurally valid, on-chain)
#      while echoing the SAME (resource.url, toolName) tuple with the
#      attacker's own payTo — the poison-mcp attack;
#   3. settlement SUCCEEDS on-chain, but EXTENSION-RESPONSES reports the
#      listing rejected with bazaar_listing_owned_by_other_payee, and the
#      catalog entry is byte-identical before and after (still Policywright's).
#
# Same environment + provenance as scripts/policywright-demo.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\n== %s ==\n' "$*"; }
die()  { echo "policywright-negative: FAIL — $*" >&2; exit 1; }

PW_REPO="${PW_REPO:-$ROOT/../policywright}"
PW_INTEGRATION="$PW_REPO/integrations/walras-x402"

[ -f .env ] || die ".env missing."
[ -d "$PW_INTEGRATION" ] || die "Policywright integration not found at $PW_INTEGRATION (set PW_REPO)."

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

FAC_PORT="${PORT:-4021}"
PW_MCP_PORT="${PW_MCP_PORT:-4024}"
FAC="http://127.0.0.1:${FAC_PORT}"
PW_MCP_URL="http://127.0.0.1:${PW_MCP_PORT}/mcp"
TSX="./node_modules/.bin/tsx"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$ROOT/demo-logs/run-${STAMP}-policywright-negative"
mkdir -p "$LOG_DIR"
DEMO_DB="$ROOT/data/policywright-negative-catalog.db"

say "walras × Policywright negative path (logs: $LOG_DIR)"

http_code() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }
[ "$(http_code "$FAC/health")" = "000" ] || die "something is already on :$FAC_PORT"
[ "$(http_code "$PW_MCP_URL")" = "000" ] || die "something is already on :$PW_MCP_PORT"

pnpm -s build >"$LOG_DIR/build.log" 2>&1 || die "walras build failed"

PIDS=()
cleanup() { for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT

say "booting facilitator (fresh catalog) + Policywright tool"
rm -f "$DEMO_DB" "$DEMO_DB-wal" "$DEMO_DB-shm"
DB_PATH="$DEMO_DB" PORT="$FAC_PORT" node packages/facilitator/dist/index.js >"$LOG_DIR/facilitator.log" 2>&1 &
PIDS+=($!)
for i in $(seq 1 60); do [ "$(http_code "$FAC/health")" = "200" ] && break; sleep 0.5; done
[ "$(http_code "$FAC/health")" = "200" ] || die "facilitator not ready"

( cd "$PW_INTEGRATION" && FACILITATOR_URL="$FAC" PW_MCP_PORT="$PW_MCP_PORT" PW_PAYTO_ADDRESS="$PW_PAYTO_ADDRESS" \
    ./node_modules/.bin/tsx server.ts ) >"$LOG_DIR/pw-seller.log" 2>&1 &
PIDS+=($!)
for i in $(seq 1 60); do code="$(http_code "$PW_MCP_URL")"; [ "$code" != "000" ] && break; sleep 0.5; done
[ "$code" != "000" ] || die "Policywright seller did not come up"

say "1. honest first payment — catalog the tool under its real payTo"
( cd demo && FACILITATOR_URL="$FAC" PW_MCP_URL="$PW_MCP_URL" PW_DEMO_QUERY="policywright" \
    "$TSX" policywright-session.ts ) >"$LOG_DIR/catalog.log" 2>&1 \
  || die "honest cataloging run failed — see $LOG_DIR/catalog.log"
echo "cataloged (see $LOG_DIR/catalog.log)"

say "2. poison-mcp — attacker echoes the tool's tuple with its own payTo"
( cd demo && FACILITATOR_URL="$FAC" TARGET_URL="$PW_MCP_URL" TOOL_NAME="synthesize" HOSTILE_MODE="poison-mcp" \
    "$TSX" hostile-client.ts ) | tee "$LOG_DIR/poison-mcp.log" \
  || die "hostile client crashed"

say "3. assert: settle succeeded, listing rejected, catalog untouched"
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const er = r.extensionResponses && r.extensionResponses.bazaar;
  const settled = r.settleResponse && (r.settleResponse.success === true || typeof r.settleResponse.transaction === "string");
  if (!settled) { console.error("EXPECTED on-chain settlement success; got", JSON.stringify(r.settleResponse)); process.exit(1); }
  if (!er || er.status !== "rejected" || er.code !== "bazaar_listing_owned_by_other_payee") {
    console.error("EXPECTED bazaar_listing_owned_by_other_payee; got", JSON.stringify(er)); process.exit(1);
  }
  const target = process.env.TARGET_URL || "http://127.0.0.1:4024/mcp";
  const owners = (r.catalogAfter.items || [])
    .filter(i => i.type === "mcp" && i.resource === target)
    .flatMap(i => (i.accepts || []).map(a => a.payTo));
  if (!owners.includes(process.env.PW_PAYTO_ADDRESS) || owners.includes(r.attacker)) {
    console.error("EXPECTED the listing still owned by the real payTo, not the attacker; owners:", owners); process.exit(1);
  }
  console.log("NEGATIVE-OK  settle succeeded on-chain; listing rejected:", er.code);
  console.log("             reason:", er.reason || er.rejectedReason || "(reason in header)");
  console.log("             catalog still owned by", process.env.PW_PAYTO_ADDRESS);
' "$LOG_DIR/poison-mcp.log" || die "negative-path assertions failed"

say "PASS"
echo "transcript: $LOG_DIR/poison-mcp.log"
