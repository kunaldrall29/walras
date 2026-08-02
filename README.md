# walras

An [x402](https://github.com/x402-foundation/x402) facilitator for Stellar, plus a Bazaar
discovery layer.

Apache-2.0. Built against the pinned spec commit
`x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`.

---

## Status

| Component | State |
| --- | --- |
| Facilitator — `POST /verify`, `POST /settle`, `GET /supported` on `stellar:testnet` | built |
| Stock-client conformance — unmodified `@x402/fetch` buyer paid an unmodified `@x402/express` seller through walras; settled on `stellar:testnet` | **proven** — tx [`ac50c091…cc155`](https://stellar.expert/explorer/testnet/tx/ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155), EVIDENCE S2-2/S2-3 |
| x402 repo e2e suite against walras (`--families=stellar --testnet`) | **4/4 pass** — EVIDENCE S2-4 |
| Bazaar catalog — settle-gated automatic cataloging (`EXTENSION-RESPONSES`) + `GET /discovery/resources` (seven filters, offset pagination) | **proven live** — stock seller's resource cataloged by paying, no registration step; hostile extensions soft-dropped with machine reasons while settlement succeeds on-chain; EVIDENCE S3-3/S3-4 |
| Bazaar search (`/discovery/search`), MCP live demo | not built (S4/S5) |

The facilitator wraps [`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar)'s
`ExactStellarScheme`, which already enforces every MUST in the exact-Stellar scheme spec.
walras adds the HTTP surface, the configuration surface, and an error model that guarantees
a machine-readable code *and* a non-null human-readable reason on every rejection. It adds
no payment validation of its own — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for
where that line is drawn and why.

## Quick start

Requires Node ≥ 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env          # then fill in SUBMITTER_SECRET
pnpm preflight                # submitter funded? RPC reachable?
pnpm --filter @walras/facilitator dev
```

```bash
curl -s localhost:4021/supported | jq
```

```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "stellar:testnet",
      "extra": { "areFeesSponsored": true }
    }
  ],
  "extensions": [],
  "signers": { "stellar:*": ["G..."] }
}
```

Fees are sponsored by the configured submitter account: the buyer needs the payment asset
and never spends a sequence number or pays a network fee.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/verify` | x402 v2 spec §7.1 request and response shapes |
| `POST` | `/settle` | §7.2. Verifies independently; never assumes a prior `/verify` |
| `GET` | `/supported` | §7.3. `kinds`, `extensions`, `signers` |
| `GET` | `/health` | Operational readiness. Not part of x402 |

A payment the scheme rejects returns **200** carrying `isValid: false` (or
`success: false`) with the reason code, matching the reference facilitator. **4xx** is
reserved for requests that could not be interpreted as an x402 exchange at all.

## Configuration

`SUBMITTER_SECRET` is the only required variable. The full table, including `FEE_MODE`,
`DB_PATH`, and the fee-bump options, is in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §3.5 and [`.env.example`](./.env.example).

## Demo

[`demo/`](./demo) holds the Session 2 acceptance case: a minimal seller wired from stock
`@x402/express` and a buyer wired from stock `@x402/fetch` — zero custom protocol code on
either side. With the facilitator running and `.env` populated:

```bash
pnpm --filter @walras/demo seller    # :4022, pays out to SERVER_STELLAR_ADDRESS
pnpm --filter @walras/demo buyer     # pays 0.01 USDC, prints the settled tx hash
```

`demo/tap.mjs` is a transparent logging proxy used to capture the wire transcripts in
EVIDENCE S2-2; `demo/e2e-proxy/` exposes walras to the x402 repo's e2e harness.

## Development

```bash
pnpm test              # single-SDK assertion, then the facilitator suite
pnpm typecheck
pnpm check:licenses    # gate G-LIC — no copyleft in the dependency tree
pnpm fixtures          # regenerate test payment payloads (needs .env)
```

Tests are hermetic: no `.env`, no secrets, and an in-process Soroban RPC double stands in
for the network. What that double does and does not model is documented in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §4.1 — results obtained through it are
labelled as modelled rather than observed on-chain.

## Documentation

| File | Contents |
| --- | --- |
| [`docs/FACTS.md`](./docs/FACTS.md) | Every protocol, library, and API claim, with source and date. Nothing is asserted anywhere in this repo without a VERIFIED row here |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Each point where the spec, the SDK, the reference operator, or the RFP disagree, and what walras does about it |
| [`docs/EVIDENCE.md`](./docs/EVIDENCE.md) | Captured transcripts and measurements. Every "works" claim points here |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Repository layout, request path, error model, testing strategy |
| [`docs/rfp.md`](./docs/rfp.md) | The SCF RFP this project answers, verbatim |
