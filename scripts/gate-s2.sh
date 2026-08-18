#!/usr/bin/env bash
# Gate S2 — Session 2 (live conformance) state is reproducible offline.
#
# What S2 proved live on stellar:testnet is recorded in EVIDENCE S2-1…S2-6
# (stock-client round-trip, on-chain settlement, 4/4 e2e, negative tests).
# This gate re-checks everything about that state that can be verified
# without touching the chain: the dependency invariant, the facilitator
# suite, and the presence of the evidence and FACTS rows the later
# sessions build on. Exit 0 = pass.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "gate-s2: FAIL — $1" >&2; exit 1; }
command -v pnpm >/dev/null || fail "pnpm not on PATH (corepack enable)"

echo "gate-s2: [1/4] single @stellar/stellar-sdk in the tree (DECISIONS D-013)"
pnpm check:deps >/dev/null || fail "check:deps"

echo "gate-s2: [2/4] facilitator suite green"
pnpm --filter @walras/facilitator test >/dev/null 2>&1 || fail "facilitator tests"

echo "gate-s2: [3/4] EVIDENCE sections S2-1 … S2-6 present"
for s in S2-1 S2-2 S2-3 S2-4 S2-5 S2-6; do
  grep -q "^## $s " docs/EVIDENCE.md || fail "EVIDENCE $s missing"
done

echo "gate-s2: [4/4] FACTS rows F-065 … F-069 VERIFIED"
for f in F-065 F-066 F-067 F-068 F-069; do
  grep -Eq "\| $f \|.*\| VERIFIED \|" docs/FACTS.md || fail "FACTS $f not VERIFIED"
done

echo "gate-s2: PASS"
