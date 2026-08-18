import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

/**
 * Fixture builders for the catalog tests.
 *
 * The extension shapes are transcribed from the spec's own examples
 * (`specs/extensions/bazaar.md` §PaymentRequired at the pinned SHA), so a
 * fixture passing validation is also a check that walras accepts exactly what
 * the spec publishes.
 */

/** Testnet USDC SAC (FACTS F-052) — realistic asset for requirements fixtures. */
export const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** A seller address fixture (structurally valid Stellar G-address). */
export const SELLER_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** A second, different seller address for poisoning tests. */
export const SELLER_B = "GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK";

/** A fixed ISO timestamp; the store never reads the clock (determinism). */
export const T0 = "2026-08-02T12:00:00.000Z";
export const T1 = "2026-08-02T13:00:00.000Z";

/**
 * Builds verified-shape payment requirements.
 *
 * @param overrides - Field overrides.
 * @returns Payment requirements for `stellar:testnet` USDC.
 */
export function makeRequirements(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet" as PaymentRequirements["network"],
    asset: USDC_TESTNET,
    amount: "100000",
    payTo: SELLER_A,
    maxTimeoutSeconds: 300,
    extra: { decimals: 7 },
    ...overrides,
  };
}

/**
 * Builds a valid GET-endpoint bazaar extension, verbatim from the spec's
 * "Example: GET Endpoint".
 *
 * @returns The extension object.
 */
export function makeGetExtension(): Record<string, unknown> {
  return {
    info: {
      input: { type: "http", method: "GET", queryParams: { city: "San Francisco" } },
      output: { type: "json", example: { city: "San Francisco", weather: "foggy" } },
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
            queryParams: {
              type: "object",
              properties: { city: { type: "string", description: "City name to query" } },
              required: ["city"],
            },
          },
          required: ["type", "method"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { type: { type: "string" }, example: { type: "object" } },
          required: ["type"],
        },
      },
      required: ["input"],
    },
  };
}

/**
 * Builds a valid MCP-tool bazaar extension, verbatim from the spec's
 * "Example: MCP Tool".
 *
 * @param toolName - The MCP tool name (the second half of the tuple key).
 * @returns The extension object.
 */
export function makeMcpExtension(toolName = "financial_analysis"): Record<string, unknown> {
  return {
    info: {
      input: {
        type: "mcp",
        toolName,
        description: "Advanced AI-powered financial analysis",
        inputSchema: {
          type: "object",
          properties: {
            ticker: { type: "string", description: "Ticker symbol to analyze" },
            analysis_type: { type: "string", enum: ["quick", "deep"] },
          },
          required: ["ticker"],
        },
        example: { ticker: "AAPL", analysis_type: "deep" },
      },
      output: { type: "json", example: { summary: "Strong fundamentals...", score: 8.5 } },
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
            description: { type: "string" },
            transport: { type: "string", enum: ["streamable-http", "sse"] },
            inputSchema: { type: "object" },
            example: { type: "object" },
          },
          required: ["type", "toolName", "inputSchema"],
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
  };
}

/**
 * Builds a v2 payment payload carrying a resource block and extensions.
 *
 * @param overrides - Overrides for the payload; `resource` and `extensions`
 *   merge shallowly over sensible defaults.
 * @returns The payment payload.
 */
export function makePayload(
  overrides: {
    x402Version?: number;
    resource?: Record<string, unknown> | undefined;
    extensions?: Record<string, unknown> | undefined;
  } = {},
): PaymentPayload {
  const payload = {
    x402Version: overrides.x402Version ?? 2,
    resource:
      "resource" in overrides
        ? overrides.resource
        : { url: "https://api.example.com/weather", description: "Weather data endpoint" },
    accepted: makeRequirements(),
    payload: { transaction: "AAAA" },
    extensions: "extensions" in overrides ? overrides.extensions : { bazaar: makeGetExtension() },
  };
  return payload as unknown as PaymentPayload;
}
