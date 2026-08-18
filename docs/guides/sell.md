# Sell: charge per request and become discoverable

You have an HTTP API — or an MCP tool server — and want to charge USDC per
call on Stellar. This guide takes you from a plain route to a paid endpoint
that shows up in the Bazaar discovery catalog, using only stock x402 SDK
packages pointed at a walras facilitator.

Other roles: [buy-agent.md](./buy-agent.md) · [operate.md](./operate.md)

## What you'll have at the end

An endpoint that answers `402 Payment Required` with machine-readable terms,
gets paid in testnet USDC through walras, and appears in the discovery catalog
the moment its first payment settles. This guide contains no registration call
because none exists anywhere in walras: settlement is what creates the listing
(D-004, D-022). The whole integration is the stock `@x402/express` middleware
plus `declareDiscoveryExtension` in your route config (F-074).

## Prerequisites

- Node ≥ 22 — `@x402/stellar` declares `engines.node >= 22` (F-058).
- pnpm 10 via corepack (`corepack enable`), git, curl.
- A walras facilitator to settle through — `http://127.0.0.1:4021` if you run
  your own ([operate.md](./operate.md)).
- Testnet accounts. From a walras checkout:

  ```bash
  cp .env.example .env
  node scripts/setup-accounts.mjs
  ```

  The script creates and Friendbot-funds three accounts (facilitator
  submitter, seller, buyer), adds USDC trustlines to seller and buyer, and
  prints a ready-to-paste `.env` fragment
  ([`scripts/setup-accounts.mjs`](../../scripts/setup-accounts.mjs)).
- The reserve nuance behind that trustline: one base reserve is 0.5 XLM, and
  each trustline raises the account's minimum balance by one base reserve
  (F-085). Invisible on testnet, because Friendbot funds 10 000 XLM (F-085);
  real on pubnet — an account needs spare XLM above its current minimum before
  it can add the USDC trustline. Your `payTo` address must hold the trustline
  before it can receive USDC.
- To test your endpoint end to end, a buyer must hold testnet USDC. The only
  documented faucet is captcha-gated — faucet.circle.com, select Stellar — so
  that step needs a human (F-056).

## Steps

### 1. Install the stock SDK packages

In your server project (all `@x402/*` packages at exactly `2.20.0` — upstream
versions move fast, so pin them; F-061):

```bash
pnpm add express @x402/express @x402/core @x402/stellar @x402/extensions
```

### 2. Declare a paid route

This is the complete integration — middleware plus route config. It is the
same wiring as [`demo/seller.ts`](../../demo/seller.ts), reduced to one route:

```ts
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
const PAY_TO = process.env.SERVER_STELLAR_ADDRESS; // your G... address

const server = new x402ResourceServer([new HTTPFacilitatorClient({ url: FACILITATOR_URL })]);
server.register("stellar:*", new ExactStellarScheme());

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: { payTo: PAY_TO, scheme: "exact", price: "$0.01", network: "stellar:testnet" },
        description: "Current weather report for a named city",
        mimeType: "application/json",
        serviceName: "Example Weather",
        tags: ["weather"],
        extensions: {
          ...declareDiscoveryExtension({
            method: "GET",
            input: { city: "Zurich", units: "metric" },
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string", description: "City to report current weather for" },
                units: { type: "string", description: "Unit system: metric or imperial" },
              },
              required: ["city"],
            },
            output: { example: { city: "Zurich", condition: "sunny", temperatureC: 24 } },
          }),
        },
      },
    },
    server,
  ),
);

app.get("/weather", (_req, res) => res.json({ city: "Zurich", condition: "sunny", temperatureC: 24 }));
app.listen(4022);
```

There is nothing else. The middleware detects the bazaar declaration in route
config and auto-registers the resource-server extension itself (F-074). A
price of `"$0.01"` becomes `amount: "100000"` on the wire — USDC base units at
7 decimals (F-008).

### 3. Write metadata the search indexer can rank

The indexer ranks listings by service name, description, parameter text, and
tags — where parameter text is parameter *names* plus JSON-Schema
`description` annotations, and example values are deliberately not indexed
(D-026). An example `city: "Zurich"` says nothing about what your resource
does; `"City to report current weather for"` does. So:

- Put a plain sentence in every parameter's `description`.
- `serviceName` is capped at 32 printable-ASCII characters, `tags` at 5
  entries of 32 characters each — anything over is soft-dropped, not rejected
  (F-031).

### 4. Take the first payment — settlement is registration

Start your server, then have any stock buyer pay it once (the walras checkout
ships one: [`demo/buyer.ts`](../../demo/buyer.ts)). Cataloging is triggered by
the buyer's client echoing your bazaar declaration back inside the payment
payload — if the client omits the echo, no cataloging occurs, and you cannot
force a listing (F-032). The listing is created by the settlement itself
(D-004); the full loop — pay, then listed, zero registration steps — ran live
on `stellar:testnet` (F-075, EVIDENCE S3-3).

### 5. Read the cataloging outcome

walras reports what happened to your listing in the `EXTENSION-RESPONSES`
header of the settle response — base64-encoded JSON keyed by extension name
(F-024). `bazaar.status` is `success`, or `rejected` with a human-readable
`rejectedReason` plus a machine-readable `code` alongside it (D-014). The
stock middleware logs it for you; captured live (EVIDENCE S3-3):

```
[x402] extension responses: {"bazaar":{"status":"success"}}
```

That log line is stock behavior — the SDK's facilitator client prints
`status`, `rejectedReason`, and `code` from the header (F-073).

### 6. Verify your listing

```bash
curl "http://127.0.0.1:4021/discovery/resources?payTo=G...YOURPAYTO"
```

The response's `items` array carries your listing (F-025, F-027): the
`accepts` of the settled payment, your metadata, and the full
`extensions.bazaar` block agents build requests from. Your listing is owned by
its first settled `payTo` — a real, settled payment to any other payee cannot
touch it, demonstrated live against a hostile client (D-024, EVIDENCE S3-4).

### 7. MCP tool sellers

An MCP server charges per tool call with the stock `@x402/mcp` wrapper
(F-078). The shape, condensed from [`demo/mcp-seller.ts`](../../demo/mcp-seller.ts):

```ts
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const resourceServer = new x402ResourceServer([new HTTPFacilitatorClient({ url: FACILITATOR_URL })]);
resourceServer.register("stellar:*", new ExactStellarScheme());
await resourceServer.initialize(); // required before buildPaymentRequirements (F-083)

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact", network: "stellar:testnet", payTo: PAY_TO, price: "$0.02",
});

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  resource: { url: "http://127.0.0.1:4023/mcp", description: "…", serviceName: "…" },
  extensions: declareDiscoveryExtension({
    toolName: "my_tool",
    description: "What the tool does, in one plain sentence",
    inputSchema: { type: "object", properties: { /* … with descriptions … */ } },
    output: { example: { /* … */ } },
  }),
});
// mcp.registerTool("my_tool", {…}, paid(async args => ({ content: [/* … */] })));
```

Three things the HTTP path hides:

- You must `await resourceServer.initialize()` before building requirements —
  it refuses kinds no facilitator has advertised, so the facilitator must be
  up before your seller boots (F-083).
- Set `resource.url` to the real, dialable endpoint of your MCP server. The
  catalog canonicalizes origin plus path (F-051), and agents dial exactly what
  the listing names.
- MCP listings are keyed on the tuple `(resource.url, toolName)`, so several
  tools on one endpoint each get their own listing (F-029).

## The live example

- HTTP seller: [`demo/seller.ts`](../../demo/seller.ts), driven by
  [`scripts/demo.sh`](../../scripts/demo.sh). The pay-then-listed flow was
  proven live on `stellar:testnet` (EVIDENCE S3-3) — settlement
  [`81c4baac…9b3f`](https://stellar.expert/explorer/testnet/tx/81c4baac7e7766610a945b56abfac7b0893d75f54f3e6f32fd8113b471b99b3f)
  created the listing, and the one-command demo repeats it from an empty
  catalog (EVIDENCE S5-2).
- The ownership defense: `./scripts/demo.sh --poison-catalog` shows a real
  settled payment failing to touch another seller's listing (EVIDENCE S5-3).
- MCP seller: [`demo/mcp-seller.ts`](../../demo/mcp-seller.ts), driven by
  [`scripts/mcp-demo.sh`](../../scripts/mcp-demo.sh). A live MCP tool was paid
  and auto-cataloged by that very settlement (EVIDENCE S6-3) — tx
  [`d57ccaea…8d02`](https://stellar.expert/explorer/testnet/tx/d57ccaeafb912a388bce2f19751e17588b86103ed55ff5e1e6dd74e54afc8d02).

## Troubleshooting

Codes below are from the [error registry](../reference/errors.md); on the
seller path they arrive inside the `EXTENSION-RESPONSES` header's `bazaar`
object unless noted. A rejected catalog write never affects the settlement
itself (D-015).

| Symptom | Code | What it means | What to do |
| --- | --- | --- | --- |
| Settle succeeds, header says `rejected` | [`bazaar_spec_validation_failed`](../reference/errors.md) | Your declared discovery info violates the bazaar protocol invariants | Fix the `declareDiscoveryExtension` arguments — the `rejectedReason` names the field |
| Settle succeeds, header says `rejected` | [`bazaar_schema_validation_failed`](../reference/errors.md) | The `info` block does not validate against the schema you declared | Make the example `input` match your own `inputSchema` |
| Settle succeeds, header says `rejected` | [`bazaar_resource_url_invalid`](../reference/errors.md) | The resource URL is not an absolute http(s) URL without credentials | Serve the route at a plain http(s) URL |
| Settle succeeds, header says `rejected` | [`bazaar_extensions_too_large`](../reference/errors.md) | The extensions block exceeds the 64 KiB indexing cap | Trim schemas and examples |
| Your listing never updates | [`bazaar_listing_owned_by_other_payee`](../reference/errors.md) | The URL is already cataloged for a different `payTo` (D-024) | Keep paying with the original `payTo`, or list under a different URL |
| No `EXTENSION-RESPONSES` header at all | — | The buyer's client omitted the echo, so no cataloging occurred (F-032) — or a walras-internal indexer fault, which omits the header rather than blaming you (D-025) | Pay once with a stock client; if the header still never appears, report it to the operator |
| Middleware refuses your route at boot | [`walras_unsupported_kind`](../reference/errors.md) | Your route's (scheme, network) pair is not advertised by the facilitator | `curl <facilitator>/supported` and match your route config to its `kinds` |
