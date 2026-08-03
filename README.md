# walras

An [x402](https://github.com/x402-foundation/x402) facilitator for Stellar, plus a Bazaar
discovery layer: any seller whose payment settles through walras is automatically listed
in a searchable catalog — no registration step exists, anywhere.

Apache-2.0. Built against the pinned spec commit
`x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`.

---

## Status — everything below is proven live on `stellar:testnet`

| Component | State |
| --- | --- |
| Facilitator — `POST /verify`, `POST /settle`, `GET /supported` | **proven** — stock-client conformance, tx [`ac50c091…cc155`](https://stellar.expert/explorer/testnet/tx/ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155), EVIDENCE S2-2/S2-3 |
| x402 repo e2e suite against walras (`--families=stellar --testnet`) | **4/4 pass** — EVIDENCE S2-4 |
| Settle-gated automatic cataloging + `GET /discovery/resources` (seven filters) | **proven** — pay → listed, zero registration; hostile writes soft-dropped with machine reasons; EVIDENCE S3-3/S3-4 |
| `GET /discovery/search` — BM25 ranking, cursor pagination, truthful `partialResults` | **proven** — recall@5 0.93, MRR@10 0.91 on a 28-query eval; EVIDENCE S4-3/S4-4 |
| One-command demo: search → pay → tx hash → auto-listed, plus three negative paths | **proven** — EVIDENCE S5-2/S5-3 |
| Measured settlement fee | **0.0022973 XLM** (22 973 stroops), uniform across every observed settlement — EVIDENCE S2-3, S5-2 |

The facilitator wraps [`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar)'s
`ExactStellarScheme`, which already enforces every MUST in the exact-Stellar scheme spec.
walras adds the HTTP surface, the configuration surface, the discovery layer, and an error
model that guarantees a machine-readable code *and* a non-null human-readable reason on
every rejection path. It adds no payment validation of its own — see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for where that line is drawn and why.

## Quickstart: docs to a paid, discoverable endpoint

Prerequisites: Node ≥ 22, pnpm 10 (`corepack enable` gets you pnpm), git, curl.
Measured times below are from a timed clean-machine walkthrough (EVIDENCE S5-5); the
whole path fits comfortably inside an hour, including the one manual faucet step.

**1. Clone and install** (~2 min)

```bash
git clone <this-repo> && cd walras
pnpm install
```

**2. Create and fund testnet accounts** (~2 min automated + one manual faucet visit)

```bash
cp .env.example .env
node scripts/setup-accounts.mjs
```

The script creates the three accounts (facilitator submitter, seller, buyer), funds them
with XLM via Friendbot, sets up the USDC trustlines, and prints a ready-to-paste `.env`
fragment. Paste it into `.env`. One step cannot be automated: fund the **buyer** address
the script prints with testnet USDC at [faucet.circle.com](https://faucet.circle.com)
(select Stellar — captcha-gated, so it needs a human).

**3. Preflight** (~10 s)

```bash
pnpm preflight     # submitter funded? RPC reachable?
```

**4. The demo** (~2 min, five real settlements on stellar:testnet)

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

## Configuration

`SUBMITTER_SECRET` is the only required variable. The full table, including `FEE_MODE`,
`DB_PATH`, and the fee-bump options, is in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §3.5 and [`.env.example`](./.env.example).

## Development

```bash
pnpm test              # single-SDK assertion, then the workspace suites (157 tests)
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

| File | Contents |
| --- | --- |
| [`docs/FACTS.md`](./docs/FACTS.md) | Every protocol, library, and API claim, with source and date. Nothing is asserted anywhere in this repo without a VERIFIED row here |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Each point where the spec, the SDK, the reference operator, or the RFP disagree, and what walras does about it |
| [`docs/EVIDENCE.md`](./docs/EVIDENCE.md) | Captured transcripts and measurements. Every "works" claim points here |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Repository layout, request path, error model, testing strategy |
| [`docs/rfp.md`](./docs/rfp.md) | The SCF RFP this project answers, verbatim |
