#!/usr/bin/env bash
# walras one-command demo — Session 5.
#
# Happy path (no flags): boots the facilitator and a stock seller against a FRESH
# empty catalog, lets real settlements on stellar:testnet populate it (settle-gated
# cataloging, DECISIONS D-004), then runs an agent that searches /discovery/search,
# pays the top hit through the stock client, and prints the tx hash, its
# stellar.expert link, the fee Horizon charged, and the catalog entry the
# settlement refreshed — plus the EXTENSION-RESPONSES the stock seller middleware
# logged (FACTS F-024, F-073).
#
# Negative paths (one flag per run), each ending in a machine-readable reason:
#   --expired         stock-built payload whose auth entry is allowed to expire
#                     → invalid_exact_stellar_payload_simulation_failed (F-064)
#   --tampered        requirements claim double the signed amount
#                     → invalid_exact_stellar_payload_wrong_amount (S2-6 live)
#   --poison-catalog  attacker's REAL settled self-payment claims the seller's URL
#                     → settlement succeeds, catalog write refused with
#                       bazaar_listing_owned_by_other_payee (D-024, S3-4 live)
#
# Options: --seed-all (seed all 11 corpus routes, default 4), --query "<text>"
# (agent search query, default "current weather in Zurich").
#
# Requires: .env populated (scripts/setup-accounts.mjs + faucet.circle.com),
# pnpm install already run. Everything else is orchestrated here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$ROOT/scripts/demo.sh"
cd "$ROOT"

MODE=happy
SEED_SCOPE=default
AGENT_QUERY_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expired) MODE=expired ;;
    --tampered) MODE=tampered ;;
    --poison-catalog) MODE=poison ;;
    --seed-all) SEED_SCOPE=all ;;
    --query) shift; AGENT_QUERY_ARG="${1:?--query needs a value}" ;;
    -h|--help)
      sed -n '2,25p' "$SELF" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "demo: unknown flag $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '\n== %s ==\n' "$*"; }
die()  { echo "demo: FAIL — $*" >&2; exit 1; }

# --- preconditions ----------------------------------------------------------
[ -f .env ] || die ".env missing. Run: cp .env.example .env, then node scripts/setup-accounts.mjs and paste its fragment in."
set -a; . ./.env; set +a
SUBMITTER="${SUBMITTER_SECRET:-${FACILITATOR_STELLAR_PRIVATE_KEY:-}}"
[ -n "$SUBMITTER" ] || die "SUBMITTER_SECRET (or FACILITATOR_STELLAR_PRIVATE_KEY) is not set in .env"
[ -n "${CLIENT_STELLAR_PRIVATE_KEY:-}" ] || die "CLIENT_STELLAR_PRIVATE_KEY is not set in .env"
[ -n "${SERVER_STELLAR_ADDRESS:-}" ] || die "SERVER_STELLAR_ADDRESS is not set in .env"
[ -d node_modules ] && [ -d demo/node_modules ] || die "dependencies missing — run: pnpm install"
command -v curl >/dev/null || die "curl is required"

FAC_PORT="${PORT:-4021}"
SELLER_PORT="${SELLER_PORT:-4022}"
FAC="http://127.0.0.1:${FAC_PORT}"
SELLER="http://127.0.0.1:${SELLER_PORT}"
HORIZON="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
RPC="${RPC_URL:-https://soroban-testnet.stellar.org}"
TSX="./node_modules/.bin/tsx"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$ROOT/demo-logs/run-${STAMP}-${MODE}"
mkdir -p "$LOG_DIR"
DEMO_DB="$ROOT/data/demo-catalog.db"

say "walras demo — mode: $MODE (logs: $LOG_DIR)"

http_code() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }

[ "$(http_code "$FAC/health")" = "000" ] || die "something is already listening on :$FAC_PORT — stop it or set PORT"
if [ "$MODE" = happy ] || [ "$MODE" = poison ]; then
  [ "$(http_code "$SELLER/weather")" = "000" ] || die "something is already listening on :$SELLER_PORT — stop it or set SELLER_PORT"
fi

# Balance/trustline preflight for the modes that settle real payments.
if [ "$MODE" = happy ] || [ "$MODE" = poison ]; then
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
fi

say "building packages"
pnpm -s build >"$LOG_DIR/build.log" 2>&1 || die "build failed — see $LOG_DIR/build.log"

# --- process management -----------------------------------------------------
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

start_facilitator() {
  rm -f "$DEMO_DB" "$DEMO_DB-wal" "$DEMO_DB-shm"
  say "booting walras facilitator on :$FAC_PORT (fresh catalog: $DEMO_DB)"
  DB_PATH="$DEMO_DB" PORT="$FAC_PORT" node packages/facilitator/dist/index.js \
    >"$LOG_DIR/facilitator.log" 2>&1 &
  PIDS+=($!)
  wait_http "$FAC/health" 200 "facilitator"
  echo "facilitator ready: $FAC ($(curl -s "$FAC/supported" | head -c 120)…)"
}

start_seller() {
  say "booting stock @x402/express seller on :$SELLER_PORT (11 paid routes from eval/search/corpus.json)"
  ( cd demo && FACILITATOR_URL="$FAC" SELLER_PORT="$SELLER_PORT" "$TSX" seller.ts ) \
    >"$LOG_DIR/seller.log" 2>&1 &
  PIDS+=($!)
  wait_http "$SELLER/weather" 402 "seller"
  echo "seller ready: $SELLER (every route answers 402 until paid)"
}

seed() { # comma-separated ids ("" = all)
  ( cd demo && SEED_IDS="$1" SELLER_ORIGIN="$SELLER" "$TSX" seed-catalog.ts ) \
    | tee -a "$LOG_DIR/seed.log"
}

catalog_total() {
  curl -s "$FAC/discovery/resources" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).pagination.total))'
}

last_extension_responses() {
  grep -F "extension responses" "$LOG_DIR/seller.log" | tail -1 | sed 's/^.*\[x402\]/[x402]/' \
    || echo "(none logged)"
}

# --- modes ------------------------------------------------------------------

run_happy() {
  start_facilitator
  start_seller

  say "1/5 the catalog starts EMPTY — nothing is listed until something settles"
  echo "GET $FAC/discovery/resources -> total: $(catalog_total)"

  say "2/5 first payment: the stock client pays /weather — settling IS listing"
  seed "weather-current"
  echo
  echo "the stock seller middleware just logged walras's EXTENSION-RESPONSES header:"
  echo "  $(last_extension_responses)"
  echo "catalog total is now: $(catalog_total) — auto-listed, no registration call exists anywhere"

  if [ "$SEED_SCOPE" = all ]; then
    REST="weather-history,air-quality,fx-rates,stock-quote,crypto-price,geocode-forward,geocode-reverse,ip-info,sentiment,translate"
  else
    REST="weather-history,fx-rates,crypto-price"
  fi
  say "3/5 seeding more of the catalog the same way (${REST//,/ , })"
  seed "$REST"
  echo "catalog total is now: $(catalog_total)"

  say "4/5 agent: search -> pay -> hash"
  ( cd demo && FACILITATOR_URL="$FAC" HORIZON_URL="$HORIZON" \
      AGENT_QUERY="${AGENT_QUERY_ARG:-current weather in Zurich}" "$TSX" agent.ts ) \
    | tee "$LOG_DIR/agent.log"

  say "5/5 EXTENSION-RESPONSES for the agent's settlement"
  echo "  $(last_extension_responses)"

  say "summary"
  node -e '
    const fs = require("fs");
    const dir = process.argv[1];
    const seeds = fs.readFileSync(`${dir}/seed.log`, "utf8").split("\n")
      .filter(l => l.startsWith("{")).map(l => JSON.parse(l));
    for (const s of seeds)
      console.log(`  seeded ${s.id.padEnd(16)} tx ${s.transaction}`);
    const agentLine = fs.readFileSync(`${dir}/agent.log`, "utf8").split("\n")
      .find(l => l.startsWith("AGENT-REPORT "));
    const a = JSON.parse(agentLine.slice("AGENT-REPORT ".length));
    console.log(`  agent paid ${a.picked}`);
    console.log(`  tx   ${a.transaction}`);
    console.log(`  link https://stellar.expert/explorer/testnet/tx/${a.transaction}`);
    console.log(`  fee  ${a.feeStroops} stroops`);
  ' "$LOG_DIR"
  echo "  catalog listings: $(catalog_total)"
  echo
  echo "DEMO: PASS — search -> pay -> hash -> auto-listed, all live on stellar:testnet"
}

run_tampered() {
  start_facilitator
  say "building an HONEST payload via the stock client path (signs a 100000 base-unit transfer)"
  ( cd demo && NEGATIVE_MAX_TIMEOUT_SECONDS=60 TARGET_URL="$SELLER/weather" "$TSX" negative-payload.ts ) \
    >"$LOG_DIR/payload.json"
  echo "payload built (createdAtLedger $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).createdAtLedger)' "$LOG_DIR/payload.json"))"

  say "tampering: paymentRequirements now CLAIM double the signed amount (100000 -> 200000)"
  node -e '
    const fs = require("fs");
    const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).requestBody;
    body.paymentRequirements = { ...body.paymentRequirements, amount: "200000" };
    fetch(`${process.argv[2]}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async res => {
      const out = await res.json();
      console.log(`POST /verify -> HTTP ${res.status}`);
      console.log(JSON.stringify(out, null, 2));
      if (out.isValid !== false || !out.invalidReason) process.exit(1);
      fs.writeFileSync(`${process.argv[3]}/verify.json`, JSON.stringify(out));
    });
  ' "$LOG_DIR/payload.json" "$FAC" "$LOG_DIR" || die "expected isValid:false with a non-null invalidReason"

  REASON="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).invalidReason)' "$LOG_DIR/verify.json")"
  say "machine-readable reason"
  echo "  invalidReason: $REASON"
  echo
  echo "DEMO --tampered: PASS — rejected with $REASON"
}

run_expired() {
  start_facilitator
  say "building a SHORT-LIVED payload via the stock client path (maxTimeoutSeconds=15)"
  ( cd demo && NEGATIVE_MAX_TIMEOUT_SECONDS=15 TARGET_URL="$SELLER/weather" "$TSX" negative-payload.ts ) \
    >"$LOG_DIR/payload.json"

  say "waiting for the chain to pass the auth entry's expiry (+2-ledger tolerance, FACTS F-046)"
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const report = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const expiry = Math.max(...report.signatureExpirationLedgers);
    const rpc = process.argv[2];
    console.log(`createdAtLedger ${report.createdAtLedger}, signatureExpirationLedger ${expiry}, waiting for ledger > ${expiry + 2}`);
    const deadline = Date.now() + 240_000;
    for (;;) {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
      });
      const seq = (await res.json()).result.sequence;
      console.log(`  latest ledger: ${seq}`);
      if (seq > expiry + 2) break;
      if (Date.now() > deadline) { console.error("timed out waiting for expiry"); process.exit(1); }
      await new Promise(r => setTimeout(r, 4000));
    }
  ' "$LOG_DIR/payload.json" "$RPC" || die "expiry wait failed"

  say "the expired payload, POSTed to /verify and /settle"
  node -e '
    const fs = require("fs");
    const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).requestBody;
    const fac = process.argv[2];
    const post = (path) => fetch(`${fac}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async res => [res.status, await res.json()]);
    Promise.all([post("/verify"), post("/settle")]).then(([[vs, v], [ss, s]]) => {
      console.log(`POST /verify -> HTTP ${vs}`);
      console.log(JSON.stringify(v, null, 2));
      console.log(`POST /settle -> HTTP ${ss}`);
      console.log(JSON.stringify(s, null, 2));
      if (v.isValid !== false || !v.invalidReason) process.exit(1);
      if (s.success !== false || !s.errorReason) process.exit(1);
      fs.writeFileSync(`${process.argv[3]}/rejections.json`,
        JSON.stringify({ invalidReason: v.invalidReason, errorReason: s.errorReason }));
    });
  ' "$LOG_DIR/payload.json" "$FAC" "$LOG_DIR" || die "expected both endpoints to reject with non-null reasons"

  say "machine-readable reasons"
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(`  /verify invalidReason: ${r.invalidReason}`);
    console.log(`  /settle errorReason  : ${r.errorReason}`);
    console.log("");
    console.log(`DEMO --expired: PASS — rejected with ${r.invalidReason}`);
  ' "$LOG_DIR/rejections.json"
}

run_poison() {
  start_facilitator
  start_seller

  say "1/3 the legitimate seller gets listed the only way possible: a settled payment"
  seed "weather-current"
  curl -s "$FAC/discovery/resources?payTo=$SERVER_STELLAR_ADDRESS" >"$LOG_DIR/catalog-before.json"
  echo "listing owned by $SERVER_STELLAR_ADDRESS captured"

  say "2/3 attacker pays ITSELF (real on-chain settlement) while claiming the seller's URL"
  ( cd demo && HOSTILE_MODE=poison FACILITATOR_URL="$FAC" TARGET_URL="$SELLER/weather" "$TSX" hostile-client.ts ) \
    >"$LOG_DIR/poison.json" 2>&1 || die "hostile client failed to run — see $LOG_DIR/poison.json"
  node -e '
    const report = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(`  attacker            : ${report.attacker}`);
    console.log(`  settlement          : success=${report.settleResponse.success} tx ${report.settleResponse.transaction}`);
    console.log(`  explorer            : https://stellar.expert/explorer/testnet/tx/${report.settleResponse.transaction}`);
    console.log(`  EXTENSION-RESPONSES : ${JSON.stringify(report.extensionResponses)}`);
    if (report.settleResponse.success !== true) process.exit(1);
    if (report.extensionResponses?.bazaar?.status !== "rejected") process.exit(1);
  ' "$LOG_DIR/poison.json" || die "expected settlement success WITH a rejected catalog write"

  say "3/3 the catalog is untouched"
  curl -s "$FAC/discovery/resources?payTo=$SERVER_STELLAR_ADDRESS" >"$LOG_DIR/catalog-after.json"
  node -e '
    const fs = require("fs");
    const [before, after] = [process.argv[1], process.argv[2]].map(p => JSON.parse(fs.readFileSync(p, "utf8")));
    const same = JSON.stringify(before.items) === JSON.stringify(after.items);
    console.log(`  seller listing byte-identical after the attack: ${same}`);
    if (!same) process.exit(1);
  ' "$LOG_DIR/catalog-before.json" "$LOG_DIR/catalog-after.json" || die "catalog changed under the poisoning attempt"
  ATTACKER="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).attacker)' "$LOG_DIR/poison.json")"
  ATTACKER_TOTAL="$(curl -s "$FAC/discovery/resources?payTo=$ATTACKER" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).pagination.total))')"
  echo "  listings owned by the attacker: $ATTACKER_TOTAL"

  REASON="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).extensionResponses.bazaar.code)' "$LOG_DIR/poison.json")"
  say "machine-readable reason"
  echo "  bazaar.code: $REASON"
  echo
  echo "DEMO --poison-catalog: PASS — a real settled payment could not touch another seller's listing ($REASON)"
}

case "$MODE" in
  happy)    run_happy ;;
  tampered) run_tampered ;;
  expired)  run_expired ;;
  poison)   run_poison ;;
esac
