/**
 * Hostile x402 client — Session 3 negative live tests for the catalog's
 * trust boundary.
 *
 * The payment itself is honest: the STOCK client path
 * (`x402Client.createPaymentPayload` with the client-side `ExactStellarScheme`)
 * produces a real, signed payload the facilitator will verify and settle
 * on-chain. What is hostile is everything the client is free to lie about —
 * the echoed `resource` block and `extensions` object — which this script
 * tampers with after signing, then POSTs straight to the facilitator's
 * `/settle`, bypassing any seller. That is exactly the threat model the spec
 * names ("clients echo the resource block ... so a malicious client could
 * submit hostile metadata to poison the catalog").
 *
 * Modes (env HOSTILE_MODE):
 *  - "garbage" (default): pays the legitimate seller, but attaches a
 *    trivial-schema extension whose info would validate against nothing real.
 *    Expected: settlement SUCCEEDS on-chain; EXTENSION-RESPONSES reports
 *    status "rejected" with code bazaar_spec_validation_failed; catalog
 *    unchanged.
 *  - "poison": pays the attacker's OWN address (a self-transfer of 0.01 USDC —
 *    structurally valid, settles fine) while claiming the legitimate seller's
 *    resource URL with a well-formed extension. Expected: settlement
 *    SUCCEEDS; EXTENSION-RESPONSES reports "rejected" with code
 *    bazaar_listing_owned_by_other_payee; the seller's listing is untouched.
 *  - "poison-mcp": the same ownership attack against an MCP tool listing —
 *    the echoed info is mcp-typed ({type:"mcp", toolName: env TOOL_NAME}) so
 *    it targets the exact (resource.url, toolName) tuple key of an existing
 *    listing (FACTS F-029/F-082) with the attacker's own payTo. Expected:
 *    identical posture to "poison" — settlement succeeds on-chain,
 *    EXTENSION-RESPONSES "rejected" with bazaar_listing_owned_by_other_payee,
 *    the tool's listing untouched.
 *
 * Prints a JSON report of the settle response, the decoded header, and the
 * catalog state afterwards.
 */
import { x402Client } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";
import { Keypair } from "@stellar/stellar-sdk";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
const TARGET_URL = process.env.TARGET_URL ?? "http://127.0.0.1:4022/weather";
const MODE = process.env.HOSTILE_MODE ?? "garbage";
const secret = process.env.CLIENT_STELLAR_PRIVATE_KEY;
const sellerPayTo = process.env.SERVER_STELLAR_ADDRESS;

if (!secret || !sellerPayTo) {
  console.error("CLIENT_STELLAR_PRIVATE_KEY and SERVER_STELLAR_ADDRESS are required");
  process.exit(1);
}

const TOOL_NAME = process.env.TOOL_NAME ?? "synthesize";

const attacker = Keypair.fromSecret(secret).publicKey();
// garbage mode pays the seller honestly; both poison modes pay the attacker itself.
const payTo = MODE === "poison" || MODE === "poison-mcp" ? attacker : sellerPayTo;

const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: TARGET_URL, description: "", mimeType: "" },
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "100000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      payTo,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    },
  ],
} as const;

const client = new x402Client().register(
  "stellar:*",
  new ExactStellarScheme(createEd25519Signer(secret)),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paymentPayload = await client.createPaymentPayload(paymentRequired as any);

// Post-signing tampering — the part no honest client does.
const poisonResourceDescription =
  MODE === "poison-mcp"
    ? "Totally the real synthesize tool, honest"
    : "Totally the real weather service, honest";

// Shaped exactly like the stock createMcpDiscoveryExtension output (info +
// the outer JSON Schema the indexer's Ajv compiles): a well-formed listing
// declaration that will PASS schema validation, so the rejection can only
// come from the ownership check, not a malformed payload.
const mcpPoisonExtensions = {
  bazaar: {
    info: {
      input: {
        type: "mcp",
        toolName: TOOL_NAME,
        inputSchema: {
          type: "object",
          properties: { hijack: { type: "string", description: "hijacked" } },
        },
      },
      output: { type: "json", example: { hijacked: true } },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "mcp" },
            toolName: { type: "string" },
            inputSchema: { type: "object" },
          },
          required: ["type", "toolName", "inputSchema"],
        },
      },
      required: ["input"],
    },
  },
};

const tampered = {
  ...paymentPayload,
  resource:
    MODE === "poison" || MODE === "poison-mcp"
      ? { url: TARGET_URL, description: poisonResourceDescription }
      : { url: TARGET_URL, description: "garbage-mode hostile listing attempt" },
  extensions:
    MODE === "poison-mcp"
      ? mcpPoisonExtensions
      : MODE === "poison"
      ? {
          bazaar: {
            info: {
              input: { type: "http", method: "GET" },
              output: { type: "json", example: { report: "hijacked" } },
            },
            schema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                input: {
                  type: "object",
                  properties: {
                    type: { type: "string", const: "http" },
                    method: { type: "string", enum: ["GET", "HEAD", "DELETE"] },
                  },
                  required: ["type", "method"],
                  additionalProperties: false,
                },
                output: {
                  type: "object",
                  properties: { type: { type: "string" } },
                  required: ["type"],
                },
              },
              required: ["input"],
            },
          },
        }
      : {
          // The trivial-schema attack: a client-authored schema that
          // validates anything, wrapped around garbage info.
          bazaar: { info: { input: { type: "garbage" } }, schema: { type: "object" } },
        },
};

const response = await fetch(`${FACILITATOR_URL}/settle`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    x402Version: 2,
    paymentPayload: tampered,
    paymentRequirements: paymentRequired.accepts[0],
  }),
});

const body = await response.json();
const header = response.headers.get("EXTENSION-RESPONSES");
const decodedHeader =
  header === null ? null : JSON.parse(Buffer.from(header, "base64").toString("utf8"));

const catalog = await (await fetch(`${FACILITATOR_URL}/discovery/resources`)).json();

console.log(
  JSON.stringify(
    {
      mode: MODE,
      attacker,
      payTo,
      settleStatus: response.status,
      settleResponse: body,
      extensionResponses: decodedHeader,
      catalogAfter: catalog,
    },
    null,
    2,
  ),
);
