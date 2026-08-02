/**
 * Minimal x402 seller — Session 2 acceptance case, seller half; Session 3 adds
 * the bazaar discovery declaration.
 *
 * Everything protocol-shaped here is the stock SDK: `paymentMiddleware` from
 * `@x402/express`, `x402ResourceServer` + `HTTPFacilitatorClient` from `@x402/core`,
 * the server-side `ExactStellarScheme` from `@x402/stellar`, and
 * `declareDiscoveryExtension` from `@x402/extensions/bazaar` — the middleware
 * detects the declaration and auto-registers `bazaarResourceServerExtension`
 * itself. This file only chooses a route, a price, metadata, and which
 * facilitator to trust — exactly the wiring a third-party seller would write
 * against the walras facilitator. There is no registration call anywhere:
 * cataloging happens because a payment settles (DECISIONS D-004).
 *
 * The price is "$0.01" so the settled transfer is 100000 base units of USDC —
 * deliberately identical to the x402.org settlement decoded in EVIDENCE S0-4, which
 * makes the on-chain diff against the baseline exact rather than approximate.
 */
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
const PAY_TO = process.env.SERVER_STELLAR_ADDRESS;
const PORT = Number(process.env.SELLER_PORT ?? 4022);

if (!PAY_TO) {
  console.error("SERVER_STELLAR_ADDRESS is required (the seller's G... address)");
  process.exit(1);
}

const server = new x402ResourceServer([new HTTPFacilitatorClient({ url: FACILITATOR_URL })]);
server.register("stellar:*", new ExactStellarScheme());

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: {
          payTo: PAY_TO,
          scheme: "exact",
          price: "$0.01",
          network: "stellar:testnet",
        },
        description: "Live weather report for the walras demo city",
        mimeType: "application/json",
        serviceName: "Walras Demo Weather",
        tags: ["weather", "demo"],
        extensions: {
          ...declareDiscoveryExtension({
            output: { example: { report: "sunny", temperatureC: 31 } },
          }),
        },
      },
    },
    server,
  ),
);

app.get("/weather", (_req, res) => {
  res.json({ report: "sunny", temperatureC: 31 });
});

app.listen(PORT, () => {
  console.log(`seller listening on :${PORT}, payTo ${PAY_TO}, facilitator ${FACILITATOR_URL}`);
});
