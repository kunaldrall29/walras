# walras

An [x402](https://github.com/x402-foundation/x402) facilitator for Stellar, plus a Bazaar
discovery layer: any seller whose payment settles through walras is automatically listed
in a searchable catalog — no registration step exists, anywhere.

Apache-2.0. Built against the pinned spec commit
`x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`.

---

## Status — everything below is proven live on `stellar:testnet` (EVIDENCE linked per row)

| Component | State |
| --- | --- |
| Facilitator — `POST /verify`, `POST /settle`, `GET /supported` | **proven** — stock-client conformance, tx [`ac50c091…cc155`](https://stellar.expert/explorer/testnet/tx/ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155), EVIDENCE S2-2/S2-3 |
| x402 repo e2e suite against walras (`--families=stellar --testnet`) | **4/4 pass** — EVIDENCE S2-4 |
| Settle-gated automatic cataloging + `GET /discovery/resources` (seven filters) | **proven** — pay → listed, zero registration; hostile writes soft-dropped with machine reasons; EVIDENCE S3-3/S3-4 |
| `GET /discovery/search` — BM25 ranking, cursor pagination, truthful `partialResults` | **proven** — recall@5 0.93, MRR@10 0.91 on a 28-query eval; EVIDENCE S4-3/S4-4 |
| One-command demo: search → pay → tx hash → auto-listed, plus three negative paths | **proven** — EVIDENCE S5-2/S5-3 |
| MCP server — an agent completes discover→pay using **only** `search_resources` + `paid_call` | **proven** — a generic MCP client paid an http listing *and* a live MCP tool (which its own settlement auto-cataloged); EVIDENCE S6-3 |
| Measured settlement fee | **0.0022973 XLM** (22 973 stroops), uniform across every observed settlement — EVIDENCE S2-3, S5-2, S6-3 |

The facilitator wraps [`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar)'s
`ExactStellarScheme`, which already enforces every MUST in the exact-Stellar scheme spec.
walras adds the HTTP surface, the configuration surface, the discovery layer, and an error
model that guarantees a machine-readable code *and* a non-null human-readable reason on
every rejection path. It adds no payment validation of its own — see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for where that line is drawn and why.

## Quickstart: docs to a paid, discoverable endpoint

Prerequisites: Node ≥ 22, pnpm 10 (`corepack enable` gets you pnpm), git, curl.
Every duration below was measured in a timed fresh-clone walkthrough (EVIDENCE S5-5):
**≈ 1 min 40 s of machine time** end to end, plus one manual faucet visit — the whole
"docs to a paid, discoverable endpoint" path lands around 5–8 minutes, far inside the
hour bar.

**1. Clone and install** (measured: 5 s on a warm pnpm store, S5-5; expect a couple of
minutes cold)

```bash
git clone <this-repo> && cd walras
pnpm install
```

**2. Create and fund testnet accounts** (measured: 25 s automated, S5-5, + one manual faucet
visit, ~2–5 min)

```bash
cp .env.example .env
node scripts/setup-accounts.mjs
```

The script creates the three accounts (facilitator submitter, seller, buyer), funds them
with XLM via Friendbot, sets up the USDC trustlines, and prints a ready-to-paste `.env`
fragment. Paste it into `.env`. One step cannot be automated: fund the **buyer** address
the script prints with testnet USDC at [faucet.circle.com](https://faucet.circle.com)
(select Stellar — captcha-gated, so it needs a human).

**3. Preflight** (measured: 3 s, S5-5)

```bash
pnpm preflight     # submitter funded? RPC reachable?
```

**4. The demo** (measured: 65 s incl. the first build, S5-5 — five real settlements on
stellar:testnet)

```bash
./scripts/demo.sh
```

One command, end to end: boots the facilitator against a **fresh, empty catalog**, boots
a stock `@x402/express` seller with 11 paid routes, then

1. shows the catalog is empty — nothing is listed until something settles;
2. pays `/weather` once through the stock `@x402/fetch` client — the settlement itself
   creates the listing (`EXTENSION-RESPONSES: {"bazaar":{"status":"success"}}`);
3. seeds a few more routes the same way;
4. runs an **agent** that searches `/discovery/search?query=current+weather+in+Zurich`,
   pays the top-ranked result, and prints the settled tx hash, its stellar.expert link,
   and the fee Horizon actually charged;
5. re-fetches the catalog entry whose `lastUpdated` that settlement just bumped.

Every payment is the unmodified stock SDK; the seller declares its discovery metadata in
route config and never registers anything.

**5. The negative paths** — each ends in a machine-readable reason

```bash
./scripts/demo.sh --tampered        # requirements claim double the signed amount
                                    #   → invalid_exact_stellar_payload_wrong_amount
./scripts/demo.sh --expired         # auth entry allowed to expire, then replayed
                                    #   → invalid_exact_stellar_payload_simulation_failed
./scripts/demo.sh --poison-catalog  # attacker's REAL settled payment claims the
                                    # seller's URL → settlement succeeds on-chain, the
                                    # catalog write is refused with
                                    #   bazaar_listing_owned_by_other_payee
                                    # and the seller's listing is byte-identical after
```

`--poison-catalog` is the demo worth watching twice: a structurally valid, actually
settled on-chain payment is still not enough to touch another seller's listing.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/verify` | x402 v2 spec §7.1 request and response shapes |
| `POST` | `/settle` | §7.2. Verifies independently; on success, catalogs the payer's declared resource and reports the outcome in `EXTENSION-RESPONSES` |
| `GET` | `/supported` | §7.3. `kinds`, `extensions` (advertises `bazaar`), `signers` |
| `GET` | `/discovery/resources` | Bazaar catalog: seven filters (`type`, `payTo`, `scheme`, `network`, `extensions`, `limit`, `offset`), `items` + offset pagination |
| `GET` | `/discovery/search` | Ranked search: required `query` + five filters, `resources` + cursor pagination, truthful `partialResults` |
| `GET` | `/health` | Operational readiness. Not part of x402 |

A payment the scheme rejects returns **200** carrying `isValid: false` (or
`success: false`) with the reason code, matching the reference facilitator. **4xx** is
reserved for requests that could not be interpreted as an x402 exchange at all. Every
rejection path — payment, catalog, or query — carries a machine-readable code and a
non-null human-readable reason.

Fees are sponsored by the configured submitter account: the buyer needs the payment asset
and never spends a sequence number or pays a network fee.

## MCP server: the Bazaar as two agent tools

[`packages/mcp-server`](./packages/mcp-server) exposes the whole discover→pay loop to
any MCP client (Claude Code, or anything speaking the protocol) as two tools over
stdio:

- **`search_resources(query, filters?)`** — ranked catalog search. Each hit carries a
  deterministic `id`, name, description, price (USDC base units), network, and the
  machine-readable calling convention (method, example values, JSON Schema).
- **`paid_call(resourceId | url [+ toolName], input?)`** — calls the resource, paying
  its 402 automatically through walras with the server's Stellar wallet: http
  endpoints via the stock `@x402/fetch` path, MCP tools via the stock `@x402/mcp`
  client. Returns the result plus a receipt `{transaction, network, payer}` with the
  on-chain hash. Per-call spend is capped (`WALRAS_MCP_MAX_AMOUNT`, default 1 USDC) —
  an over-cap 402 is refused before anything is signed.

Every failure, on every path, is a structured `{errorCode, reason}` — facilitator
codes pass through verbatim; the server never throws free-text at an agent.

```bash
./scripts/mcp-demo.sh   # facilitator + stock seller + a PAID MCP TOOL seller, then a
                        # generic MCP client (zero walras imports) does:
                        # search → pay by id → pay an MCP tool by (url, toolName)
                        # → that settlement auto-catalogs the tool → re-found in
                        # search → re-paid by its minted id. Three on-chain receipts.
```

Point an interactive client at it with:

```json
{ "command": "node", "args": ["packages/mcp-server/dist/index.js"],
  "env": { "FACILITATOR_URL": "http://127.0.0.1:4021", "CLIENT_STELLAR_PRIVATE_KEY": "S..." } }
```

Without `CLIENT_STELLAR_PRIVATE_KEY` the server runs search-only and `paid_call`
says so (`walras_mcp_wallet_not_configured`).

## Configuration

`SUBMITTER_SECRET` is the only required variable. The full table, including `FEE_MODE`,
`DB_PATH`, and the fee-bump options, is in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §3.5 and [`.env.example`](./.env.example).

## Development

```bash
pnpm test              # single-SDK assertion, then the workspace suites (204 tests)
pnpm typecheck
pnpm check:licenses    # gate G-LIC — no copyleft in the dependency tree
pnpm eval:search       # search-quality eval: 28 labeled queries against the corpus
pnpm fixtures          # regenerate test payment payloads (needs .env)
```

Tests are hermetic: no `.env`, no secrets, and an in-process Soroban RPC double stands in
for the network. What that double does and does not model is documented in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §4.1 — results obtained through it are
labelled as modelled rather than observed on-chain.

[`demo/`](./demo) holds the pieces `scripts/demo.sh` orchestrates — stock seller, stock
buyer, discovery agent, and the two hostile clients — plus `tap.mjs`, the transparent
logging proxy behind the EVIDENCE wire transcripts, and `e2e-proxy/`, which exposes
walras to the x402 repo's own e2e harness.

## Documentation

Start here by role: [sell](./docs/guides/sell.md) · [buy / build an agent](./docs/guides/buy-agent.md) ·
[operate a facilitator](./docs/guides/operate.md) — or the [quickstart](./docs/quickstart.md).

| File | Contents |
| --- | --- |
| [`docs/FACTS.md`](./docs/FACTS.md) | Every protocol, library, and API claim, with source and date. Nothing is asserted anywhere in this repo without a VERIFIED row here |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Each point where the spec, the SDK, the reference operator, or the RFP disagree, and what walras does about it |
| [`docs/EVIDENCE.md`](./docs/EVIDENCE.md) | Captured transcripts and measurements. Every "works" claim points here |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | As-built architecture: components, settlement path, indexing invariant, topologies, docs pipeline |
| [`docs/MODELS.md`](./docs/MODELS.md) | Domain and data models, payment lifecycle, catalog ERD |
| [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) | STRIDE-lite over the payment and discovery trust boundaries, with the test behind each control |
| [`docs/api/openapi.yaml`](./docs/api/openapi.yaml) | **Generated** from the Fastify route schemas — `pnpm docs:gen` |
| [`docs/reference/config.md`](./docs/reference/config.md) | **Generated** configuration reference (facilitator + MCP server) |
| [`docs/reference/errors.md`](./docs/reference/errors.md) | **Generated** error-code registry (all four taxonomies) |
| [`docs/runbook.md`](./docs/runbook.md) | Operator runbook: backup, keys, monitoring, degraded modes |
| [`docs/glossary.md`](./docs/glossary.md) · [`docs/faq.md`](./docs/faq.md) | Terms with citations; the questions the guides can't answer inline |
| [`docs/litepaper/walras-litepaper.md`](./docs/litepaper/walras-litepaper.md) | The design paper ([one-page abstract](./docs/litepaper/ABSTRACT.md)) |
| [`docs/rfp.md`](./docs/rfp.md) | The SCF RFP this project answers, verbatim |

`pnpm docs:gen` regenerates everything marked generated plus the diagram SVGs;
`pnpm docs:check` is the CI gate (drift, OpenAPI lint, stale SVGs, links, claims audit).
