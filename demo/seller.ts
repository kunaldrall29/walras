/**
 * Minimal x402 seller — Session 2 acceptance case, seller half.
 *
 * Everything protocol-shaped here is the stock SDK: `paymentMiddleware` from
 * `@x402/express`, `x402ResourceServer` + `HTTPFacilitatorClient` from `@x402/core`,
 * and the server-side `ExactStellarScheme` from `@x402/stellar`. This file only
 * chooses a route, a price, and which facilitator to trust — exactly the wiring a
 * third-party seller would write against the walras facilitator.
 *
 * The price is "$0.01" so the settled transfer is 100000 base units of USDC —
 * deliberately identical to the x402.org settlement decoded in EVIDENCE S0-4, which
 * makes the on-chain diff against the baseline exact rather than approximate.
 */
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

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
