# Operate: run your own walras facilitator

walras is Apache-2.0 with a copyleft-free dependency path (F-060), so running
your own instance is a supported topology, not a special build: the same code
every transcript in [EVIDENCE](../EVIDENCE.md) exercises, started by you. A
self-hosted instance catalogs what settles through *it* — the catalog is the
settle-gated Bazaar of the seller guide (D-004).

Other roles: [sell.md](./sell.md) · [buy-agent.md](./buy-agent.md)

## What you'll have at the end

A facilitator on `stellar:testnet` that serves `POST /verify`,
`POST /settle`, `GET /supported`, the two discovery endpoints, and
`GET /health`, sponsors the network fee of every settlement from your
submitter account (F-006), and answers every rejection with a
machine-readable code plus a non-null reason
([error registry](../reference/errors.md)).

## Prerequisites

- Node ≥ 22 — `@x402/stellar` declares `engines.node >= 22` (F-058).
- pnpm 10 via corepack (`corepack enable`), git, curl.
- A submitter account holding XLM. It sponsors network fees and never holds
  the payment asset, so it needs no trustline (F-006);
  `node scripts/setup-accounts.mjs` creates and funds it.
- If you also create seller/buyer accounts for smoke-testing: one base
  reserve is 0.5 XLM and each USDC trustline raises an account's minimum
  balance by one base reserve (F-085) — invisible on testnet because
  Friendbot funds 10 000 XLM (F-085), real on pubnet. Buyer USDC comes from
  the captcha-gated Circle faucet (faucet.circle.com, select Stellar — needs
  a human, F-056).

## Steps

### 1. Clone and install

```bash
git clone <this-repo> && cd walras
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
```

`SUBMITTER_SECRET` is the only required variable. Everything else — network,
RPC URL, port, catalog path, fee ceiling — is documented with defaults in the
generated [configuration reference](../reference/config.md); this guide does
not duplicate that table. Two properties worth internalizing:

- walras chooses to exit with code 78 (`EX_CONFIG`) on invalid configuration
  *before* binding a port — a facilitator that starts half-configured would
  advertise capability it cannot honour.
- `FEE_MODE` governs the walras *service* fee (`free` is the only implemented
  mode). It is distinct from `extra.areFeesSponsored`, which is about
  *network* fees and is always `true` (F-006).

### 3. Create and fund the accounts

```bash
node scripts/setup-accounts.mjs
```

Paste the printed fragment into `.env`
([`scripts/setup-accounts.mjs`](../../scripts/setup-accounts.mjs)).

### 4. Preflight

```bash
pnpm preflight
```

Confirms the submitter parses, exists on-chain, and holds XLM, and that the
Soroban RPC endpoint answers — an unfunded submitter is not a degraded
facilitator but one that cannot settle at all (F-006). The timed fresh-clone
walkthrough put this step at 3 s (EVIDENCE S5-5).

### 5. Build, start, check

```bash
pnpm build
node packages/facilitator/dist/index.js
```

Then, from another shell:

```bash
curl http://127.0.0.1:4021/health      # operational readiness; not part of x402
curl http://127.0.0.1:4021/supported
```

`/supported` returns `kinds`, `extensions`, and `signers` — all three
required (F-040). The Stellar kind carries `extra.areFeesSponsored: true`,
byte-identical to the x402.org baseline capture for `stellar:testnet`
(F-041), and `extensions` lists `bazaar` because the discovery endpoints are
mounted and reachable — advertised and reachable support must never diverge
(D-016).

### 6. Choose your submitter posture

Throughput scale-out is configuration, not code changes (D-012):

- `SUBMITTER_SECRET` accepts a comma-separated list; multiple submitters run
  under the package's round-robin signer selection (F-044).
- `FEE_BUMP_SECRET` names a dedicated fee account: each settlement is wrapped
  in a fee-bump transaction, decoupling fee payment from sequence-number
  management (F-047). The reference operator runs exactly this posture in
  production — its settlements show `source_account ≠ fee_account` (F-055).
  Note honestly: a live fee-bump settlement by walras itself is not yet
  captured (EVIDENCE "Not yet captured"); the knob is configuration plus a
  funded fee account (D-021).

### 7. Know what you are sponsoring

Every observed walras settlement on `stellar:testnet` charged the submitter
22 973 stroops = 0.0022973 XLM — measured, and uniform across runs (F-069).
The settlement fee is derived from a fresh settle-time simulation and capped
by `MAX_TRANSACTION_FEE_STROOPS`, default 50 000 stroops (F-037) — roughly 2x
headroom over the observed fee (F-069). Budget the submitter's XLM against
your expected settlement volume.

### 8. What is deliberately not there yet

- **Caller authentication and rate limiting: not implemented.** Any client
  that can reach the port can ask the facilitator to verify and settle.
  RFP 3.1 leaves the mechanism to the operator, and walras plans both as
  operator-configurable surfaces; until then, put your own gateway in front
  if you need either. Stated plainly so you can plan around it.
- `FEE_MODE` other than `free`: a startup error, not a silent fallback.
- Catalog federation across instances: planned, not yet designed in detail
  ([ARCHITECTURE §6.2](../ARCHITECTURE.md)).

For backup, monitoring, and incident depth — the catalog SQLite file
(`DB_PATH`, WAL mode; D-023), log expectations, and recovery drills — see the
[runbook](../runbook.md).

## The live example

[`scripts/demo.sh`](../../scripts/demo.sh) boots exactly this facilitator
build (`packages/facilitator/dist`) against a fresh catalog, settles five
real payments through it, and exits 0 — proven live (EVIDENCE S5-2).
The same path was timed end to end from a fresh clone (EVIDENCE S5-5):
about 100 s of machine time including the first build (EVIDENCE S5-5). The x402
repo's own e2e suite ran against walras as an external facilitator with a
4/4 result (EVIDENCE S2-4). The first settlement your configuration
reproduces is the S2 conformance transaction (EVIDENCE S2-2, S2-3):
[`ac50c091…c155`](https://stellar.expert/explorer/testnet/tx/ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155).

## Troubleshooting

Codes are from the [error registry](../reference/errors.md). Remember the
status convention: a payment the scheme rejects is a **200** carrying
`isValid: false` / `success: false` with the code; 4xx is reserved for
requests that could not be interpreted as x402 at all. Before any of the
rows below: a process that dies at startup with exit code 78 is refusing
invalid configuration — read its message, fix `.env`, restart.

| Symptom | Code | What it means | What to do |
| --- | --- | --- | --- |
| Clients get 200 + rejection for a kind you expected to serve | [`walras_unsupported_kind`](../reference/errors.md) | The (scheme, network) pair is not advertised by this deployment | Check `NETWORK` in `.env` against `GET /supported` |
| 404 with a code | [`walras_unknown_route`](../reference/errors.md) | No route at that method/path — the reason text lists what is mounted | Fix the caller's URL |
| Settles rejected under load | [`invalid_exact_stellar_payload_simulation_failed`](../reference/errors.md) | Mandatory re-simulation did not succeed against the RPC — seen live under real testnet congestion (EVIDENCE S5-5) | Check RPC health (`pnpm preflight`); expect clients to retry |
| Settle rejected | [`settle_exact_stellar_transaction_submission_failed`](../reference/errors.md) | The network rejected the submission — nothing reached the ledger | Check submitter XLM balance and RPC status; the S5-5 congestion forensics show the failure shape (EVIDENCE S5-5) |
| Settle rejected | [`settle_exact_stellar_transaction_failed`](../reference/errors.md) | Submitted, but did not reach SUCCESS on-chain | Inspect the transaction on Horizon; the buyer was re-402'd by the stock middleware |
| Verify rejected | [`invalid_exact_stellar_payload_fee_exceeds_maximum`](../reference/errors.md) | The simulation-derived fee exceeds your `MAX_TRANSACTION_FEE_STROOPS` ceiling (F-037) | Raise the ceiling deliberately — observed fees sit near 23 000 stroops (F-069) |
| 500 with a code | [`walras_internal_error`](../reference/errors.md) | A walras fault; says nothing about the payment's validity | Check the facilitator log; file an issue with the request shape |
