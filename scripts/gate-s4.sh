#!/usr/bin/env bash
# Gate S4 — spec-shaped search, labeled BASELINE retriever, reproducible eval.
#
# The five checks:
#   1. FACTS pre-flight — the search wire facts (F-026 param name, F-027
#      resources array, F-028 partialResults/pagination, F-076 FTS5, F-077
#      pagination.limit semantics) all VERIFIED.
#   2. Endpoint-shape golden tests and the exactly-once cursor walks green
#      (bazaar search suite + facilitator search-endpoint suite), and both
#      cursor-walk tests present by title.
#   3. Eval reproducible from the working tree with the regression gate:
#      `pnpm eval:search --gate` fails on >5% nDCG@10 drop vs the committed
#      eval/search/baseline.json.
#   4. No embedding/vector/model dependencies anywhere in the workspace —
#      the retriever is lexical BASELINE by design (DECISIONS D-026).
#   5. The BASELINE label present in code, README, and the endpoint's own
#      metadata (the /discovery/search route description).
# Exit 0 = pass.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "gate-s4: FAIL — $1" >&2; exit 1; }
command -v pnpm >/dev/null || fail "pnpm not on PATH (corepack enable)"

echo "gate-s4: [1/5] FACTS pre-flight (F-026 … F-028, F-076, F-077 VERIFIED)"
for f in F-026 F-027 F-028 F-076 F-077; do
  grep -Eq "\| $f \|.*\| VERIFIED \|" docs/FACTS.md || fail "FACTS $f not VERIFIED"
done

echo "gate-s4: [2/5] endpoint-shape goldens + exactly-once cursor walks green"
pnpm --filter @walras/bazaar test >/dev/null 2>&1 || fail "bazaar search tests"
pnpm --filter @walras/facilitator test >/dev/null 2>&1 || fail "facilitator tests"
grep -q "walks the full result set exactly once, in rank order" \
  packages/bazaar/test/search.test.ts || fail "store-level exactly-once cursor test missing"
grep -q "walks the full result set exactly once via cursors" \
  packages/facilitator/test/search-endpoint.test.ts \
  || fail "endpoint-level exactly-once cursor test missing"

echo "gate-s4: [3/5] eval reproducible + regression gate (>5% nDCG@10 fails)"
pnpm eval:search --gate >/dev/null || fail "eval:search --gate"

echo "gate-s4: [4/5] no embedding/vector/model dependencies"
enc=$(grep -hE '"(dependencies|devDependencies)"' -A 30 \
  package.json packages/*/package.json demo/package.json \
  | grep -iE "embed|vector|onnx|xenova|tensorflow|torch|openai|cohere|faiss|hnswlib" || true)
[ -z "$enc" ] || fail "embedding-ish dependency found: $enc"

echo "gate-s4: [5/5] BASELINE label in code, README, endpoint metadata"
grep -q "BASELINE" packages/bazaar/src/retriever.ts || fail "retriever.ts label"
grep -q "BASELINE" README.md || fail "README label"
grep -q "BASELINE" packages/facilitator/src/routeSchemas.ts || fail "route metadata label"

echo "gate-s4: PASS"
