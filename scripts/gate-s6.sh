#!/usr/bin/env bash
# Gate S6 — a real production tool (Policywright), paid by a zero-integration
# agent, cataloged by its first payment; the evidence pack finalized.
#
# Design notes:
#  - The live demo depends on an EXTERNAL repo checkout (Policywright, branch
#    walras-x402-integration) that a clean walras clone does not contain, and
#    on funded testnet accounts. So the gate does not *require* re-running it;
#    the durable, network-checkable proof is the two settled MCP paid-call
#    hashes recorded in EVIDENCE §S6-4, which this gate verifies on-chain.
#  - Set GATE_LIVE=1 (with PW_REPO pointing at the integration checkout and a
#    populated .env) to also re-run scripts/policywright-demo.sh end to end.
#  - Set GATE_SKIP_HORIZON=1 to skip the on-chain hash checks (offline CI).
#
# The checks:
#   1. Pre-flight G6.1 — gates s3, s4, s5 each exit 0.
#   2. FACTS — Q-019 CLOSED; F-093, F-094 VERIFIED.
#   3. EVIDENCE §S6-4 — present, with the two settled hashes, the
#      POLICYWRIGHT-SESSION-REPORT, and the negative-path rejection code.
#   4. The two MCP paid-call hashes are real, successful stellar:testnet
#      transactions (Horizon).
#   5. The walras-side demo wiring exists and typechecks: the agent session,
#      both orchestration scripts, the poison-mcp negative mode, the DEX USDC
#      helper.
#   6. The Policywright-side diff: if a checkout is locatable, assert the
#      integration files exist on branch walras-x402-integration; otherwise
#      report it as external (F-093 records it) — never a silent pass.
#   7. README truth: the Policywright claim greps to a settled hash / anchor;
#      the doc claims-audit passes.
# Exit 0 = pass.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "gate-s6: FAIL — $1" >&2; exit 1; }
command -v pnpm >/dev/null || fail "pnpm not on PATH (corepack enable)"

HASH1="3ff7309bc7641372265c4cbb89ddc314c430585085b1b2ccb0d4dbeea9f6bf04"
HASH2="980c3c5934b0405e501127d04fb246322a28afa8a610cbdfe48dcdd353c48cc4"
HORIZON="${HORIZON_URL:-https://horizon-testnet.stellar.org}"

echo "gate-s6: [1/7] pre-flight — gates s3, s4, s5 each exit 0 (G6.1)"
for g in gate-s3 gate-s4 gate-s5; do
  bash "scripts/$g.sh" >/dev/null 2>&1 || fail "$g did not pass"
done

echo "gate-s6: [2/7] FACTS — Q-019 CLOSED; F-093, F-094 VERIFIED"
grep -Eq "\| Q-019 \|.*\*\*CLOSED" docs/FACTS.md || fail "Q-019 not CLOSED"
for f in F-093 F-094; do
  grep -Eq "\| $f \|.*\| VERIFIED \|" docs/FACTS.md || fail "FACTS $f not VERIFIED"
done

echo "gate-s6: [3/7] EVIDENCE §S6-4 — hashes, session report, negative code"
grep -q "^## S6-4 " docs/EVIDENCE.md || fail "EVIDENCE S6-4 missing"
grep -q "POLICYWRIGHT-SESSION-REPORT" docs/EVIDENCE.md || fail "session report missing"
grep -q "$HASH1" docs/EVIDENCE.md || fail "first MCP paid-call hash missing from evidence"
grep -q "$HASH2" docs/EVIDENCE.md || fail "second MCP paid-call hash missing from evidence"
grep -q "bazaar_listing_owned_by_other_payee" docs/EVIDENCE.md \
  || fail "poison-mcp rejection code missing from evidence"

echo "gate-s6: [4/7] the two settled hashes are real, successful on testnet"
if [ "${GATE_SKIP_HORIZON:-0}" = "1" ]; then
  echo "gate-s6:        skipped (GATE_SKIP_HORIZON=1)"
else
  for h in "$HASH1" "$HASH2"; do
    ok="$(curl -s "$HORIZON/transactions/$h" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        try { const j=JSON.parse(s); process.stdout.write(j.successful===true ? "ok" : "no"); }
        catch { process.stdout.write("err"); }
      });' 2>/dev/null || echo err)"
    [ "$ok" = "ok" ] || fail "tx $h not confirmed successful on Horizon (got: $ok) — set GATE_SKIP_HORIZON=1 to skip"
  done
fi

echo "gate-s6: [5/7] walras-side demo wiring present + typechecks"
for f in demo/policywright-session.ts scripts/policywright-demo.sh \
         scripts/policywright-negative.sh scripts/testnet-usdc.mjs; do
  [ -f "$f" ] || fail "missing $f"
done
grep -q "poison-mcp" demo/hostile-client.ts || fail "poison-mcp mode missing from hostile-client.ts"
grep -q "PW_MCP_URL" scripts/policywright-demo.sh || fail "policywright-demo.sh not wired to the tool URL"
pnpm --filter @walras/demo run typecheck >/dev/null 2>&1 || fail "demo package typecheck"

echo "gate-s6: [6/7] Policywright-side diff on branch walras-x402-integration"
PW_REPO="${PW_REPO:-$PWD/../policywright}"
if [ -d "$PW_REPO/.git" ] && [ -d "$PW_REPO/integrations/walras-x402" ]; then
  for f in server.ts package.json setup-payto.mjs README.md; do
    [ -f "$PW_REPO/integrations/walras-x402/$f" ] || fail "Policywright integration missing $f"
  done
  git -C "$PW_REPO" rev-parse --verify walras-x402-integration >/dev/null 2>&1 \
    || fail "branch walras-x402-integration not found in $PW_REPO"
  git -C "$PW_REPO" ls-tree -r --name-only walras-x402-integration \
    | grep -q "integrations/walras-x402/server.ts" \
    || fail "the integration is not committed on branch walras-x402-integration"
  echo "gate-s6:        found at $PW_REPO on branch walras-x402-integration"
else
  echo "gate-s6:        Policywright checkout not present (external repo) — F-093 records it;"
  echo "gate-s6:        set PW_REPO to a walras-x402-integration checkout to assert the diff."
fi

echo "gate-s6: [7/7] README truth — Policywright claim greps to a settled hash"
grep -q "$HASH1" README.md || fail "README does not cite the Policywright settled hash"
pnpm docs:check --skip-drift --skip-links >/dev/null 2>&1 \
  || fail "docs claims-audit (docs:check) did not pass"

if [ "${GATE_LIVE:-0}" = "1" ]; then
  echo "gate-s6: [live] re-running scripts/policywright-demo.sh"
  bash scripts/policywright-demo.sh >/dev/null 2>&1 \
    || fail "live policywright-demo.sh run failed"
fi

echo "gate-s6: PASS"
