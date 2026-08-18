# Buy: build a client or agent that discovers and pays

You are building software that spends: a client that pays a known paid
endpoint, or an agent that first has to find one. Both paths run on stock
x402 SDK packages against a walras facilitator; the agent path can also run
entirely over MCP with two tools.

Other roles: [sell.md](./sell.md) · [operate.md](./operate.md)

## What you'll have at the end

A buyer that turns a `402 Payment Required` into a signed testnet-USDC
payment and a receipt with an on-chain transaction hash — and, if you take
the agent path, one that discovers what to pay by searching the Bazaar
catalog first. The buyer needs only the payment asset: network fees are
sponsored by the facilitator's submitter account (F-006), advertised as
`extra.areFeesSponsored: true` (F-041).

## Prerequisites

- Node ≥ 22 — `@x402/stellar` declares `engines.node >= 22` (F-058).
- pnpm 10 via corepack (`corepack enable`), git, curl.
- A walras facilitator and at least one seller listed in its catalog —
  `./scripts/demo.sh` from a walras checkout boots both.
- A funded buyer account. From a walras checkout:

  ```bash
  cp .env.example .env
  node scripts/setup-accounts.mjs
  ```

  The script creates the accounts, funds them with XLM via Friendbot, and
  adds the buyer's USDC trustline
  ([`scripts/setup-accounts.mjs`](../../scripts/setup-accounts.mjs)).
- The reserve nuance behind that trustline: one base reserve is 0.5 XLM, and
  each trustline raises the account's minimum balance by one base reserve
  (F-085). Invisible on testnet because Friendbot funds 10 000 XLM (F-085);
  real on pubnet — budget spare XLM before adding the trustline.
- Testnet USDC for the buyer address the script prints. The only documented
  faucet is captcha-gated — faucet.circle.com, select Stellar — so that step
  needs a human (F-056). Amounts are base units at 7 decimals: `"100000"` is
  0.01 USDC (F-008).

## Path A — HTTP client: pay a known endpoint

### 1. Install the stock packages

```bash
pnpm add @x402/fetch @x402/core @x402/stellar
```

### 2. Wrap fetch

The entire client, from [`demo/buyer.ts`](../../demo/buyer.ts) — zero custom
protocol code:

```ts
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

const signer = createEd25519Signer(process.env.CLIENT_STELLAR_PRIVATE_KEY);
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment("http://127.0.0.1:4022/weather", { method: "GET" });
const body = await response.json();
const receipt = new x402HTTPClient(client).getPaymentSettleResponse(name =>
  response.headers.get(name),
);
// receipt: { success, transaction, network, payer } — transaction is the on-chain hash (F-038)
```

### 3. Know what happens on the wire

One call to `fetchWithPayment` is two HTTP exchanges, all inside the SDK:

1. The unpaid request gets a `402` whose terms ride the `PAYMENT-REQUIRED`
   header — the v2 canonical name, not `X-PAYMENT` (F-065).
2. Your wallet signs a Soroban auth entry authorizing exactly
   `transfer(from, to, amount)` — not a pre-signed transaction (F-033).
3. The retry carries the payment in `PAYMENT-SIGNATURE`; the receipt comes
   back in `PAYMENT-RESPONSE` (F-065).

The whole exchange, stock client on both sides, settled live on
`stellar:testnet` (F-066, EVIDENCE S2-2).

## Path B — discovery: find what to pay

An agent that has never seen a seller's docs queries the catalog. Semantics
you must get right:

- The search parameter is `query`, never `q` — omitting it gets a named 400,
  [`walras_missing_search_query`](../reference/errors.md) (D-006, F-026).
- The two endpoints return different array fields: `GET /discovery/resources`
  returns `items`, `GET /discovery/search` returns `resources` (D-001,
  F-027). Read the right one or you will silently see nothing.
- List filters are seven: `type`, `payTo`, `scheme`, `network`, `extensions`,
  `limit`, `offset`; `limit` defaults to 20, clamped 1–100 (F-025).
- Search pagination is a real keyset cursor (D-027): pass `pagination.cursor`
  back to get the next page; a cursor replayed against a different query or
  filter set gets [`walras_invalid_search_cursor`](../reference/errors.md)
  (D-027). `partialResults: true` means exactly that matches were truncated
  from this response (F-028), and search's `pagination.limit` is the number
  of results in *this* page, not the requested maximum (F-077).
- Each listing carries its machine-readable calling convention in
  `extensions.bazaar` — for HTTP, `info.input` holds `method` and example
  `queryParams`/`body`, with the JSON Schema in the outer `schema` object;
  for MCP, `info.input` holds `toolName` and `inputSchema` inline (F-082).

```bash
curl "http://127.0.0.1:4021/discovery/search?query=current+weather+in+Zurich&limit=5"
```

[`demo/agent.ts`](../../demo/agent.ts) is the full flow in one file: search,
build the request from the listing's `info.input`, pay with the Path-A
client, print the transaction hash and the fee Horizon charged.

## Path C — MCP agent: two tools, zero integration code

Point any MCP client at [`packages/mcp-server`](../../packages/mcp-server)
over stdio (build first with `pnpm build`):

```json
{ "command": "node", "args": ["packages/mcp-server/dist/index.js"],
  "env": { "FACILITATOR_URL": "http://127.0.0.1:4021", "CLIENT_STELLAR_PRIVATE_KEY": "S..." } }
```

Two tools carry the whole discover-then-pay loop (F-080):

- `search_resources(query, filters?)` — ranked catalog search. Each hit
  carries a deterministic, self-describing id — `wr1:` plus base64url of the
  listing tuple, so the same listing yields the same id on every server
  (D-029) — plus the price in base units and the calling convention (F-082).
- `paid_call(resourceId | url [+ toolName], input?)` — resolves the target,
  probes its live 402, applies the spend policy, pays through the stock
  client path, and returns the result plus a receipt
  `{transaction, network, payer}`.

Behavior your agent can rely on:

- **Spend cap.** Per-call spending is capped at `WALRAS_MCP_MAX_AMOUNT`
  (default 10 000 000 base units = 1 USDC; D-030). The cap binds twice — a
  pre-payment check and a policy on the shared x402 client — so no transport
  bypasses it (F-081, D-030). An over-cap 402 is refused before anything is
  signed, with the amounts named; raise the variable deliberately (see the
  [configuration reference](../reference/config.md)).
- **Structured failures.** Every failure on every path is a
  `{errorCode, reason}` tool result, never free text; facilitator codes cross
  the MCP boundary verbatim (D-028).
- **Stale ids fail safe.** `paid_call` re-resolves the id against the live
  catalog before paying, so a stale id yields
  [`walras_mcp_unknown_resource_id`](../reference/errors.md) rather than a
  payment to a delisted resource (D-029).
- **No wallet, no payment.** Without `CLIENT_STELLAR_PRIVATE_KEY` the server
  runs search-only and `paid_call` says so with
  [`walras_mcp_wallet_not_configured`](../reference/errors.md) (D-030).

## The live example

- HTTP + discovery: [`scripts/demo.sh`](../../scripts/demo.sh) runs
  [`demo/agent.ts`](../../demo/agent.ts) — search, pay the top hit, print the
  hash. Proven live end to end (EVIDENCE S5-2), settlement
  [`f2857a0b…3914`](https://stellar.expert/explorer/testnet/tx/f2857a0b3af17567eaaa77638a0fcc76045a602605dfd732c7dac204010c3914).
  The first stock-client round-trip is EVIDENCE S2-2, settlement
  [`ac50c091…c155`](https://stellar.expert/explorer/testnet/tx/ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155).
- MCP: [`scripts/mcp-demo.sh`](../../scripts/mcp-demo.sh) runs
  [`demo/mcp-session.ts`](../../demo/mcp-session.ts), a generic MCP client
  with zero walras imports. Proven live in one session (EVIDENCE S6-3): paid
  an http listing by id
  ([`79b541be…b800`](https://stellar.expert/explorer/testnet/tx/79b541beb3ac7f2e9249b5270b0ee6900a3d9837ecce9a7b9e0f64a855feb800)),
  paid a live MCP tool by url + toolName
  ([`d57ccaea…8d02`](https://stellar.expert/explorer/testnet/tx/d57ccaeafb912a388bce2f19751e17588b86103ed55ff5e1e6dd74e54afc8d02)),
  then re-found and re-paid that tool by its minted id
  ([`641f3e35…7b8d`](https://stellar.expert/explorer/testnet/tx/641f3e35294d1117dda0462a4050fa83237982a1276d8ac44a0577a59f007b8d)).

## Troubleshooting

Codes are from the [error registry](../reference/errors.md). Discovery errors
arrive as `error.code` on a 4xx; payment rejections arrive as a 200 with
`isValid: false` / `success: false` plus the code; MCP errors arrive as
`structuredContent.errorCode` of an `isError` tool result (D-028).

| Symptom | Code | What it means | What to do |
| --- | --- | --- | --- |
| Search returns 400 | [`walras_missing_search_query`](../reference/errors.md) | The parameter is `query`, not `q` (D-006) | Rename the parameter |
| Search returns 400 | [`walras_invalid_search_cursor`](../reference/errors.md) | The cursor was not issued for this query + filter combination (D-027) | Restart the walk without a cursor |
| List/search returns 400 | [`walras_invalid_query_parameter`](../reference/errors.md) | A filter is malformed — `limit`/`offset` non-integer, or a repeated parameter | Fix the query string |
| Payment rejected | [`invalid_exact_stellar_payload_simulation_failed`](../reference/errors.md) | Re-simulation did not succeed — an expired auth entry, a replayed payload, and an empty USDC balance all collapse to this code (F-064) | Retry with a fresh request; check the buyer's USDC balance and trustline |
| Payment rejected | [`invalid_exact_stellar_payload_wrong_amount`](../reference/errors.md) | The signed amount does not match the requirements — the tampered-terms case (EVIDENCE S5-3) | Re-fetch the 402 and pay the terms actually offered |
| `paid_call` errors | [`walras_mcp_wallet_not_configured`](../reference/errors.md) | The MCP server has no wallet (D-030) | Set `CLIENT_STELLAR_PRIVATE_KEY` in the server's env |
| `paid_call` errors | [`walras_mcp_payment_declined_by_policy`](../reference/errors.md) | The 402 demands more than the spend cap; nothing was signed (D-030) | Raise `WALRAS_MCP_MAX_AMOUNT` if the price is acceptable |
| `paid_call` errors | [`walras_mcp_unknown_resource_id`](../reference/errors.md) | The id does not decode to a listing in this catalog (D-029) | Re-run `search_resources` and use a fresh id |
| Both tools error | [`walras_mcp_facilitator_unreachable`](../reference/errors.md) | The facilitator did not answer at the transport level | Check `FACILITATOR_URL` and that the facilitator is running |
