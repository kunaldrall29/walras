/**
 * Minimal x402 seller — Session 2 acceptance case, seller half; Session 3 added
 * the bazaar discovery declaration; Session 4 makes the route table data-driven
 * so the catalog gains enough varied listings for search to be non-trivial
 * (gate G4.1).
 *
 * Everything protocol-shaped here is the stock SDK: `paymentMiddleware` from
 * `@x402/express`, `x402ResourceServer` + `HTTPFacilitatorClient` from `@x402/core`,
 * the server-side `ExactStellarScheme` from `@x402/stellar`, and
 * `declareDiscoveryExtension` from `@x402/extensions/bazaar` — the middleware
 * detects the declaration and auto-registers `bazaarResourceServerExtension`
 * itself. This file only chooses routes, prices, metadata, and which
 * facilitator to trust — exactly the wiring a third-party seller would write
 * against the walras facilitator. There is no registration call anywhere:
 * cataloging happens because a payment settles (DECISIONS D-004).
 *
 * The route table comes from eval/search/corpus.json — the same corpus the
 * search evaluation harness measures against, so the live catalog and the eval
 * fixture stay in lockstep. Every price is "$0.01" so each settled transfer is
 * 100000 base units of USDC, identical to the x402.org settlement decoded in
 * EVIDENCE S0-4.
 */
import { readFileSync } from "node:fs";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
const PAY_TO = process.env.SERVER_STELLAR_ADDRESS;
const PORT = Number(process.env.SELLER_PORT ?? 4022);

if (!PAY_TO) {
  console.error("SERVER_STELLAR_ADDRESS is required (the seller's G... address)");
  process.exit(1);
}

interface CorpusResource {
  id: string;
  method: "GET" | "POST";
  path: string;
  price: string;
  description: string;
  mimeType: string;
  serviceName: string;
  tags: string[];
  bodyType?: "json";
  exampleInput: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  output: { example: Record<string, unknown> };
}

const corpus = JSON.parse(
  readFileSync(new URL("../eval/search/corpus.json", import.meta.url), "utf8"),
) as { resources: CorpusResource[] };

const server = new x402ResourceServer([new HTTPFacilitatorClient({ url: FACILITATOR_URL })]);
server.register("stellar:*", new ExactStellarScheme());

const app = express();

const routes = Object.fromEntries(
  corpus.resources.map((entry): [string, RouteConfig] => [
    `${entry.method} ${entry.path}`,
    {
      accepts: {
        payTo: PAY_TO,
        scheme: "exact",
        price: entry.price,
        network: "stellar:testnet",
      },
      description: entry.description,
      mimeType: entry.mimeType,
      serviceName: entry.serviceName,
      tags: entry.tags,
      extensions: {
        ...declareDiscoveryExtension({
          method: entry.method,
          input: entry.exampleInput,
          inputSchema: entry.inputSchema,
          ...(entry.bodyType !== undefined ? { bodyType: entry.bodyType } : {}),
          output: entry.output,
        } as Parameters<typeof declareDiscoveryExtension>[0]),
      },
    },
  ]),
);

app.use(paymentMiddleware(routes, server));

for (const entry of corpus.resources) {
  const handler = (_req: express.Request, res: express.Response): void => {
    res.json(entry.output.example);
  };
  if (entry.method === "GET") app.get(entry.path, handler);
  else app.post(entry.path, handler);
}

app.listen(PORT, () => {
  console.log(
    `seller listening on :${PORT}, payTo ${PAY_TO}, facilitator ${FACILITATOR_URL}, ` +
      `${corpus.resources.length} paid routes from corpus`,
  );
});
