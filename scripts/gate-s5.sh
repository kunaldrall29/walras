#!/usr/bin/env bash
# Gate S5 — the MCP agent surface: exactly two tools, one error vocabulary,
# the D-030 wallet posture, and the live discover→pay transcript.
#
# The session prompt's "no-keys server-side" letter was superseded by
# DECISIONS D-030 (EVIDENCE S6-2): this MCP server IS the agent's
# wallet-holder, so the provable invariant is narrower and stronger —
# exactly one secret-shaped config var exists (CLIENT_STELLAR_PRIVATE_KEY,
# shape-checked at boot, exit 78 on the .env.example placeholder), the
# environment is read nowhere outside config.ts, and the spend cap binds
# at two layers so no transport can pay over cap or on a foreign network.
#
# The six checks:
#   1. FACTS pre-flight — the MCP wire facts (F-078 @x402/mcp surface +
#      license, F-079 payment-over-MCP transport spec, F-080 division of
#      labor, F-081 spend-cap seam, F-082 input-schema locations, F-083
#      initialize() requirement) all VERIFIED.
#   2. @modelcontextprotocol/sdk declared in the mcp-server manifest,
#      resolved to a concrete version in pnpm-lock.yaml, package Apache-2.0.
#   3. mcp-server suite green; the tool-schema golden test present by
#      title; exactly two registerTool sites (search_resources, paid_call).
#   4. One error vocabulary — the walras_mcp_* enum exists and facilitator
#      codes pass through verbatim (D-028), asserted by test title.
#   5. Key posture per D-030 — the greps and tests described above.
#   6. Live-transcript evidence present: EVIDENCE S6-3 with the
#      MCP-SESSION-REPORT, all three settled tx hashes, and the
#      settle-cataloged MCP seller capture.
# Exit 0 = pass.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "gate-s5: FAIL — $1" >&2; exit 1; }
command -v pnpm >/dev/null || fail "pnpm not on PATH (corepack enable)"

echo "gate-s5: [1/6] FACTS pre-flight (F-078 … F-083 VERIFIED)"
for f in F-078 F-079 F-080 F-081 F-082 F-083; do
  grep -Eq "\| $f \|.*\| VERIFIED \|" docs/FACTS.md || fail "FACTS $f not VERIFIED"
done

echo "gate-s5: [2/6] @modelcontextprotocol/sdk pinned + licensed in manifest"
grep -q '"@modelcontextprotocol/sdk"' packages/mcp-server/package.json \
  || fail "@modelcontextprotocol/sdk not in mcp-server manifest"
grep -Eq "@modelcontextprotocol/sdk@[0-9]" pnpm-lock.yaml \
  || fail "@modelcontextprotocol/sdk not resolved in pnpm-lock.yaml"
grep -q '"license": "Apache-2.0"' packages/mcp-server/package.json \
  || fail "mcp-server manifest license"

echo "gate-s5: [3/6] suite green; tool-schema golden; exactly two tools"
pnpm --filter @walras/mcp-server test >/dev/null 2>&1 || fail "mcp-server tests"
grep -q "exposes exactly search_resources and paid_call, with input schemas" \
  packages/mcp-server/test/server.test.ts || fail "tool-schema golden test missing"
tools=$(grep -c "registerTool" packages/mcp-server/src/server.ts)
[ "$tools" -eq 2 ] || fail "expected exactly 2 registerTool sites, found $tools"

echo "gate-s5: [4/6] one error vocabulary — walras_mcp_* enum + verbatim passthrough (D-028)"
grep -q "WALRAS_MCP_REASON_CODES" packages/mcp-server/src/errors.ts \
  || fail "walras_mcp_* enum missing"
grep -q "^## D-028 " docs/DECISIONS.md || fail "DECISIONS D-028 missing"
grep -q "passes facilitator error codes through verbatim (D-028 taxonomy 1)" \
  packages/mcp-server/test/server.test.ts || fail "search-leg passthrough test missing"
grep -q "retries once, then passes the facilitator's settle code through verbatim" \
  packages/mcp-server/test/paid-call-http.test.ts || fail "settle-leg passthrough test missing"

echo "gate-s5: [5/6] key posture per D-030 — one shape-checked secret, capped twice"
# The environment is read in config.ts and nowhere else in the package.
envreads=$(grep -rln "process\.env\|env\." packages/mcp-server/src --include="*.ts" || true)
[ "$envreads" = "packages/mcp-server/src/config.ts" ] \
  || fail "environment read outside config.ts: $envreads"
# The only secret-shaped var the loader reads is CLIENT_STELLAR_PRIVATE_KEY.
secrets=$(grep -oE "env\.[A-Z_]*(SECRET|KEY|SEED|TOKEN|PASSWORD)[A-Z_]*" \
  packages/mcp-server/src/config.ts | sort -u)
[ "$secrets" = "env.CLIENT_STELLAR_PRIVATE_KEY" ] \
  || fail "unexpected secret-shaped config surface: $secrets"
# The seed is shape-checked at boot — the S5 fresh-clone placeholder trap.
grep -q 'S\[A-Z2-7\]{55}' packages/mcp-server/src/config.ts \
  || fail "seed shape check missing from config.ts"
# The drift guard proves loadConfig reads nothing undocumented.
grep -q "documents no variable loadConfig does not read" \
  packages/mcp-server/test/config-reference.test.ts || fail "config drift guard missing"
# The cap declines before signing on both transports, and survives the
# policy seam (F-081) — asserted by test title.
grep -q "declines an over-cap 402 without ever invoking the paying fetch" \
  packages/mcp-server/test/paid-call-http.test.ts || fail "http over-cap decline test missing"
grep -q "declines an over-cap tool price in the payment hook; the tool never executes" \
  packages/mcp-server/test/paid-call-mcp.test.ts || fail "mcp over-cap decline test missing"
grep -q "maps a client-side policy exhaustion throw to declined_by_policy (F-081)" \
  packages/mcp-server/test/paid-call-http.test.ts || fail "policy-seam test missing"

echo "gate-s5: [6/6] live transcript present (EVIDENCE S6-3, three settled txs)"
grep -q "^## S6-3 " docs/EVIDENCE.md || fail "EVIDENCE S6-3 missing"
grep -q "MCP-SESSION-REPORT" docs/EVIDENCE.md || fail "MCP-SESSION-REPORT capture missing"
grep -q "mcp-session: PASS" docs/EVIDENCE.md || fail "session PASS line missing"
for tx in \
  79b541beb3ac7f2e9249b5270b0ee6900a3d9837ecce9a7b9e0f64a855feb800 \
  d57ccaeafb912a388bce2f19751e17588b86103ed55ff5e1e6dd74e54afc8d02 \
  641f3e35294d1117dda0462a4050fa83237982a1276d8ac44a0577a59f007b8d; do
  grep -q "$tx" docs/EVIDENCE.md || fail "settled tx $tx missing from evidence"
done
grep -q "appeared in the catalog" docs/EVIDENCE.md \
  || fail "settle-cataloged MCP seller capture missing"

echo "gate-s5: PASS"
