# Quickstart — docs to a paid, discoverable endpoint

This walkthrough goes from a fresh clone to a seller that is paid through walras
and automatically listed in its discovery catalog. It is the
[README](../README.md) quickstart with the reasoning attached, and it stays
consistent with it: same five steps, same commands.

Every duration below was measured in a timed fresh-clone walkthrough (EVIDENCE S5-5).
Machine time end to end is about 1 min 40 s (EVIDENCE S5-5); with the one manual
faucet visit, the whole path lands around 5–8 minutes (EVIDENCE S5-5).

Prerequisites: Node ≥ 22 (the `@x402/*` packages declare `engines.node >= 22`,
F-058), pnpm 10 (`corepack enable` gets you pnpm), git, curl.

## 1. Clone and install

Measured at 5 s on a warm pnpm store; expect a couple of minutes cold (EVIDENCE S5-5).

```bash
git clone <this-repo> && cd walras
pnpm install
```

## 2. Create and fund testnet accounts

Measured at 25 s automated, plus one manual faucet visit of ~2–5 min (EVIDENCE S5-5).

```bash
cp .env.example .env
node scripts/setup-accounts.mjs
```

The script creates three accounts — facilitator submitter, seller, buyer — funds
each with XLM via Friendbot, adds the USDC trustlines the seller and buyer need
(F-056), and prints a ready-to-paste `.env` fragment. Paste it into `.env`.

One step cannot be automated: fund the **buyer** address the script prints with
testnet USDC at [faucet.circle.com](https://faucet.circle.com) (select Stellar).
The faucet is captcha-gated, so it needs a human (F-056).

A reserve nuance the script quietly absorbs: one Stellar base reserve is 0.5 XLM,
and each trustline raises an account's minimum balance by one base reserve (F-085).
Friendbot's testnet funding makes this invisible here; on pubnet an account needs
spare XLM above its current minimum before it can add the USDC trustline (F-085).

## 3. Preflight

Measured at 3 s (EVIDENCE S5-5).

```bash
pnpm preflight     # submitter funded? RPC reachable?
```

This checks the two preconditions without which nothing else can settle: the
submitter account exists and holds XLM to sponsor fees (F-006), and the Soroban
RPC answers. Fix anything it flags before continuing.

## 4. The demo

Measured at 65 s including the first build — five real settlements on
`stellar:testnet` (EVIDENCE S5-5, S5-2).

```bash
./scripts/demo.sh
```

One command: it boots the facilitator against a fresh, empty catalog, boots a
stock `@x402/express` seller with 11 paid routes, pays a route through the stock
`@x402/fetch` client, seeds a few more, then runs an agent that searches the
catalog, pays the top-ranked result, and prints the on-chain tx hash.

## 5. The negative paths

Each flag ends in a machine-readable reason extracted from the live response
(EVIDENCE S5-3):

```bash
./scripts/demo.sh --tampered        # → invalid_exact_stellar_payload_wrong_amount
./scripts/demo.sh --expired         # → invalid_exact_stellar_payload_simulation_failed
./scripts/demo.sh --poison-catalog  # → bazaar_listing_owned_by_other_payee
```

`--poison-catalog` is the one worth watching twice: a structurally valid, actually
settled on-chain payment still cannot touch another seller's listing (D-024).

## What just happened

Each demo phase maps to one architectural fact:

1. **The catalog starts empty.** Nothing is listed until something settles —
   cataloging is settle-gated by deliberate policy (D-004), and no registration
   endpoint exists anywhere (D-022).
2. **The first settlement auto-lists the route.** The stock client echoed the
   seller's bazaar discovery extension into the payment payload (F-032); walras
   validated it and wrote the listing, reporting the outcome to the seller in the
   `EXTENSION-RESPONSES` header as `{"bazaar":{"status":"success"}}` (F-024).
3. **More routes are seeded the same way** — one real settlement per listing.
4. **The agent searches and pays.** `GET /discovery/search?query=...` (the
   parameter is `query`, never `q` — F-026, D-006) returns ranked `resources`
   (F-027); the agent builds its request entirely from the listing's calling
   convention and pays the top hit through the stock client. The network fee is
   sponsored by the facilitator's submitter (F-006), at 22 973 stroops per
   settlement on every observed walras settlement (F-069).
5. **The catalog entry's `lastUpdated` is bumped** by that settlement — an
   ISO 8601 string, the shape the stock SDK type declares (D-002).

## Where to go next

- [Sell — make your routes discoverable](./guides/sell.md)
- [Buy — pay as a client or agent](./guides/buy-agent.md)
- [Operate — run walras yourself](./guides/operate.md)
- [Runbook](./runbook.md) — backup, key rotation, monitoring, incidents
- [Configuration reference](./reference/config.md) and
  [error registry](./reference/errors.md) — both generated from the code
