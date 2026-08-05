/**
 * Paid MCP tool seller — Session 6 acceptance case, MCP-typed half.
 *
 * Everything protocol-shaped is the stock SDK: `createPaymentWrapper` from
 * `@x402/mcp` (verify → execute → settle per the MCP transport spec, FACTS
 * F-079/F-080), `x402ResourceServer` + `HTTPFacilitatorClient` from
 * `@x402/core` pointed at walras, the server-side `ExactStellarScheme`, and
 * `declareDiscoveryExtension({toolName, …})` from `@x402/extensions/bazaar` —
 * the MCP-variant declaration whose settle-time echo lets walras catalog
 * this tool under the (resource.url, toolName) tuple key of FACTS F-029.
 *
 * `resource.url` is set to the real streamable-HTTP endpoint (NOT the
 * wrapper's `mcp://tool/...` default): the catalog canonicalizes
 * origin+pathname (F-051), and an agent must be able to dial what the
 * listing names.
 *
 * There is no registration call anywhere: the tool appears in the Bazaar
 * because somebody pays it and the payment settles (DECISIONS D-004).
 */
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
const PAY_TO = process.env.SERVER_STELLAR_ADDRESS;
const PORT = Number(process.env.MCP_SELLER_PORT ?? 4023);
const RESOURCE_URL = `http://127.0.0.1:${PORT}/mcp`;

if (!PAY_TO) {
  console.error("SERVER_STELLAR_ADDRESS is required (the seller's G... address)");
  process.exit(1);
}

const resourceServer = new x402ResourceServer([
  new HTTPFacilitatorClient({ url: FACILITATOR_URL }),
]);
resourceServer.register("stellar:*", new ExactStellarScheme());
// Fetch the facilitator's /supported kinds — buildPaymentRequirements refuses
// to fabricate requirements for kinds no facilitator has advertised.
await resourceServer.initialize();

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "stellar:testnet",
  payTo: PAY_TO,
  price: "$0.02",
});

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  resource: {
    url: RESOURCE_URL,
    description: "Translates a short English phrase into grandiloquent Victorian English",
    mimeType: "application/json",
    serviceName: "Grandiloquator",
    tags: ["translation", "victorian", "text"],
  },
  extensions: declareDiscoveryExtension({
    toolName: "grandiloquate",
    description: "Render a plain English phrase in grandiloquent Victorian style",
    inputSchema: {
      type: "object",
      properties: {
        phrase: { type: "string", description: "The plain English phrase to elevate" },
      },
      required: ["phrase"],
    },
    example: { phrase: "hello friend" },
    output: {
      example: {
        original: "hello friend",
        grandiloquent: "Salutations most esteemed companion",
      },
    },
  } as Parameters<typeof declareDiscoveryExtension>[0]),
});

/** Deterministic word-swap so the paid result is reproducible in EVIDENCE. */
const LEXICON: Record<string, string> = {
  hello: "salutations",
  hi: "felicitations",
  friend: "most esteemed companion",
  good: "supremely agreeable",
  evening: "twilight hour",
  morning: "auroral hour",
  thanks: "my profoundest gratitude",
  yes: "most assuredly",
  no: "regrettably not",
};

function grandiloquate(phrase: string): string {
  const translated = phrase
    .split(/\s+/)
    .map(word => {
      const bare = word.toLowerCase().replace(/[^a-z]/g, "");
      return LEXICON[bare] ?? word;
    })
    .join(" ");
  return translated.charAt(0).toUpperCase() + translated.slice(1);
}

function makeMcpServer(): McpServer {
  const mcp = new McpServer({ name: "grandiloquator", version: "0.1.0" });
  mcp.registerTool(
    "grandiloquate",
    {
      description: "Render a plain English phrase in grandiloquent Victorian style ($0.02)",
      inputSchema: { phrase: z.string() },
    },
    paid(async (args: { phrase: string }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            original: args.phrase,
            grandiloquent: grandiloquate(args.phrase),
          }),
        },
      ],
    })),
  );
  return mcp;
}

// Stateless streamable-HTTP hosting: one server+transport pair per request.
const app = express();
app.use(express.json());
app.post("/mcp", (req, res) => {
  void (async () => {
    const mcp = makeMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  })().catch(error => {
    console.error("mcp-seller request failed:", error);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  });
});

app.listen(PORT, () => {
  console.log(
    `mcp-seller listening on :${PORT} — paid tool "grandiloquate" at ${RESOURCE_URL}, ` +
      `payTo ${PAY_TO}, facilitator ${FACILITATOR_URL}`,
  );
});
