#!/usr/bin/env bash
# Gate S3 — settle-gated discovery catalog: suites green, live transcripts
# recorded, and the settled-payment binding provable by grep.
#
# The checks:
#   1. FACTS pre-flight — Q-001 CLOSED and F-023…F-032 (filters, envelopes,
#      EXTENSION-RESPONSES encoding, MCP keying tuple, soft-drop semantics,
#      routeTemplate rules) all VERIFIED.
#   2. Unit + poisoning suites green, with >= 20 hostile-input tests by title.
#   3. Live-transcript evidence present: S3-3 (success capture) and S3-4
#      (hostile run), including both EXTENSION-RESPONSES outcomes and the
#      poisoning machine code.
#   4. The binding grep — no code path writes a listing outside the
#      settled-payment binding: `upsertFromSettlement` has exactly one caller
#      (the indexer), `INSERT INTO resources` exists only in the store, and
#      the facilitator's only `indexSettledPayment` call site sits inside the
#      `if (result.success)` guard of the settle handler.
# Exit 0 = pass.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "gate-s3: FAIL — $1" >&2; exit 1; }
command -v pnpm >/dev/null || fail "pnpm not on PATH (corepack enable)"

echo "gate-s3: [1/4] FACTS pre-flight (Q-001 CLOSED; F-023 … F-032 VERIFIED)"
grep -Eq "\| Q-001 \|.*\*\*CLOSED\*\*" docs/FACTS.md || fail "Q-001 not CLOSED"
for f in F-023 F-024 F-025 F-026 F-027 F-028 F-029 F-030 F-031 F-032; do
  grep -Eq "\| $f \|.*\| VERIFIED \|" docs/FACTS.md || fail "FACTS $f not VERIFIED"
done

echo "gate-s3: [2/4] unit + poisoning suites green (bazaar, facilitator)"
bazaar_out=$(pnpm --filter @walras/bazaar exec vitest run --reporter=verbose 2>&1) \
  || { echo "$bazaar_out" | tail -20 >&2; fail "bazaar tests"; }
pnpm --filter @walras/facilitator test >/dev/null 2>&1 || fail "facilitator tests"
hostile=$(echo "$bazaar_out" | grep -E "✓" | grep -icE \
  "hostile|poison|traversal|forged|oversized|collision|owned|encoded|null byte|malformed|control|absolute|protocol-relative|backslash" \
  || true)
[ "$hostile" -ge 20 ] || fail "poisoning-suite breadth: $hostile hostile-input tests (< 20)"
echo "gate-s3:        $hostile hostile-input tests passing (>= 20 required)"

echo "gate-s3: [3/4] live transcripts present (EVIDENCE S3-3 success, S3-4 hostile)"
grep -q "^## S3-3 " docs/EVIDENCE.md || fail "EVIDENCE S3-3 missing"
grep -q "^## S3-4 " docs/EVIDENCE.md || fail "EVIDENCE S3-4 missing"
grep -q '"bazaar":{"status":"success"}' docs/EVIDENCE.md \
  || fail "EXTENSION-RESPONSES success capture missing"
grep -q '"status":"rejected"' docs/EVIDENCE.md \
  || fail "EXTENSION-RESPONSES rejected capture missing"
grep -q "bazaar_listing_owned_by_other_payee" docs/EVIDENCE.md \
  || fail "poisoning rejection code missing from evidence"

echo "gate-s3: [4/5] adversarial-audit regressions are present (no false all-clear)"
# The binding grep below proves no write happens OUTSIDE a settled payment — but
# URL squatting USES a real settled payment, so the grep alone would pass while the
# limitation is live. Require the attacker-first test that pins that behavior, plus
# the ReDoS and route-hardening regressions, to exist by name.
IT=packages/bazaar/test/indexer.test.ts
grep -q "attacker who settles first squats" "$IT" \
  || fail "attacker-FIRST squatting regression test missing (D-032)"
grep -q "catastrophic-backtracking pattern" "$IT" \
  || fail "Ajv ReDoS regression test missing (F-087, D-033)"
grep -q "routeTemplate hardening beyond the SDK" "$IT" \
  || fail "routeTemplate hardening regression tests missing (F-088, RFP 3.B)"
grep -q "soft-drop audit log" "$IT" \
  || fail "soft_drops audit test missing (RFP 3.A)"
grep -q "CREATE TABLE IF NOT EXISTS soft_drops" packages/bazaar/src/store.ts \
  || fail "soft_drops table missing from schema (RFP 3.A)"
grep -q "hardenRouteTemplate" packages/bazaar/src/indexer.ts \
  || fail "hardenRouteTemplate missing (RFP 3.B)"
grep -q "boundSchemaForValidation" packages/bazaar/src/indexer.ts \
  || fail "Ajv schema bounding missing (F-087, D-033)"

echo "gate-s3: [5/5] binding grep — no listing written outside the settled payment"
# The store's write method has exactly one production caller: the indexer.
callers=$(grep -rn "upsertFromSettlement(" packages/*/src --include="*.ts" \
  | grep -v "src/store.ts" || true)
[ "$(echo "$callers" | grep -c "src/indexer.ts")" -eq 1 ] \
  || fail "unexpected upsertFromSettlement callers: $callers"
[ "$(echo "$callers" | grep -vc "src/indexer.ts" || true)" -eq 0 ] \
  || fail "upsertFromSettlement called outside the indexer: $callers"
# Raw writes to the resources table exist only inside the store itself.
raw=$(grep -rln "INSERT INTO resources" packages/*/src --include="*.ts" || true)
[ "$raw" = "packages/bazaar/src/store.ts" ] || fail "raw resources INSERT outside store: $raw"
# The facilitator invokes the indexer in exactly one place: the settle
# handler, inside the settlement-success guard.
sites=$(grep -rn "indexSettledPayment(" packages/facilitator/src --include="*.ts" || true)
[ "$(echo "$sites" | grep -c .)" -eq 1 ] || fail "unexpected indexSettledPayment sites: $sites"
echo "$sites" | grep -q "src/server.ts" || fail "indexSettledPayment not in server.ts: $sites"
grep -B12 "indexSettledPayment(" packages/facilitator/src/server.ts \
  | grep -q "if (result.success)" || fail "indexSettledPayment not guarded by result.success"

echo "gate-s3: PASS"
