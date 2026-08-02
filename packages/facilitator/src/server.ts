import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  BazaarStore,
  clampLimit,
  encodeExtensionResponses,
  indexSettledPayment,
  toListResponse,
  type ListParams,
} from "@walras/bazaar";
import type { x402Facilitator } from "@x402/core/facilitator";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { describeConfig, type FacilitatorConfig } from "./config.js";
import { buildFacilitator } from "./facilitator.js";
import { reasonText, WalrasRejection } from "./errors.js";

/** The x402 protocol version this facilitator speaks (FACTS F-040). */
const X402_VERSION = 2;

/**
 * Soft wall-clock budget for the settle-time indexing hook, in milliseconds.
 *
 * The budget is enforced structurally — the indexer's 64 KiB extensions cap
 * bounds validation cost and the store's 100 ms busy timeout bounds its only
 * blocking edge — so this threshold exists to make a violation *visible* (a
 * warn log) rather than to preempt work mid-flight, which synchronous JS
 * cannot do (DECISIONS D-015).
 */
const INDEX_BUDGET_MS = 250;

/**
 * The request body shared by `POST /verify` and `POST /settle`.
 *
 * Shape is verbatim from `specs/x402-specification-v2.md` sections 7.1 and 7.2 at the
 * pinned SHA: a top-level `x402Version` alongside `paymentPayload` and
 * `paymentRequirements`. The stock `@x402/core` HTTP facilitator client sends exactly
 * this. The top-level `x402Version` is informational — routing uses
 * `paymentPayload.x402Version`, which is what the facilitator core keys registrations on.
 */
interface FacilitatorRequestBody {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/**
 * Narrows an unknown value to a plain JSON object.
 *
 * @param value - The value to test.
 * @returns True when the value is a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts the `{ paymentPayload, paymentRequirements }` envelope from a request body.
 *
 * Validates only the envelope. Everything about the *payment* — version, scheme,
 * network, transaction structure, auth entries — is left to the payment scheme, so
 * callers see the package's inherited reason codes rather than a walras paraphrase
 * (DECISIONS D-007).
 *
 * @param body - The parsed request body.
 * @returns The payload and requirements, unmodified.
 * @throws {WalrasRejection} When the envelope is absent or malformed.
 */
function parseEnvelope(body: unknown): FacilitatorRequestBody {
  if (!isObject(body)) {
    throw new WalrasRejection("walras_malformed_request_body");
  }
  if (!isObject(body.paymentPayload)) {
    throw new WalrasRejection("walras_missing_payment_payload");
  }
  if (!isObject(body.paymentRequirements)) {
    throw new WalrasRejection("walras_missing_payment_requirements");
  }
  return {
    paymentPayload: body.paymentPayload as unknown as PaymentPayload,
    paymentRequirements: body.paymentRequirements as unknown as PaymentRequirements,
  };
}

/**
 * Rejects payment kinds this facilitator does not serve, before delegating.
 *
 * The facilitator core throws a bare `Error` when no scheme is registered for a
 * (version, scheme, network) tuple, which would surface as an opaque 500. Checking the
 * tuple against the advertised kinds first turns that into a named 400 whose reason
 * points at `GET /supported`.
 *
 * This shadows none of the package's own codes. `unsupported_scheme` fires on a
 * mismatch between `paymentPayload.accepted.scheme` and the requirements, and
 * `network_mismatch` on a mismatch between the two networks — both still reachable,
 * because the check below reads only the requirements side of each pair.
 *
 * @param facilitator - The facilitator core, queried for its advertised kinds.
 * @param payload - The payment payload, for its `x402Version`.
 * @param requirements - The payment requirements, for scheme and network.
 * @throws {WalrasRejection} When the version or the (scheme, network) pair is unsupported.
 */
function assertSupportedKind(
  facilitator: x402Facilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): void {
  const kinds = facilitator.getSupported().kinds;

  if (!kinds.some(kind => kind.x402Version === payload.x402Version)) {
    throw new WalrasRejection("walras_unsupported_x402_version", {
      detail: `Received ${JSON.stringify(payload.x402Version)}; this facilitator serves ${[
        ...new Set(kinds.map(kind => kind.x402Version)),
      ].join(", ")}.`,
    });
  }

  const matches = kinds.some(
    kind =>
      kind.x402Version === payload.x402Version &&
      kind.scheme === requirements.scheme &&
      kind.network === requirements.network,
  );
  if (!matches) {
    throw new WalrasRejection("walras_unsupported_kind", {
      detail: `Received scheme '${String(requirements.scheme)}' on network '${String(
        requirements.network,
      )}'.`,
    });
  }
}

/**
 * Guarantees a rejected `VerifyResponse` carries both a machine-readable code and a
 * non-null human-readable reason (RFP 3.6).
 *
 * The reason code is never rewritten — only `invalidMessage` is backfilled, and only
 * when the scheme left it empty. Successful responses pass through untouched.
 *
 * @param result - The response from the payment scheme.
 * @returns The same response, with `invalidMessage` populated on rejection.
 */
function withVerifyReason(result: VerifyResponse): VerifyResponse {
  if (result.isValid) return result;
  const invalidReason = result.invalidReason ?? "walras_internal_error";
  return {
    ...result,
    invalidReason,
    invalidMessage: result.invalidMessage ?? reasonText(invalidReason),
  };
}

/**
 * Guarantees a failed `SettleResponse` carries both a machine-readable code and a
 * non-null human-readable reason (RFP 3.6).
 *
 * @param result - The response from the payment scheme.
 * @returns The same response, with `errorMessage` populated on failure.
 */
function withSettleReason(result: SettleResponse): SettleResponse {
  if (result.success) return result;
  const errorReason = result.errorReason ?? "walras_internal_error";
  return {
    ...result,
    errorReason,
    errorMessage: result.errorMessage ?? reasonText(errorReason),
  };
}

/**
 * Renders a wrapper-level rejection in `VerifyResponse` shape.
 *
 * Emitting the protocol shape even on a 4xx is deliberate: the stock
 * `HttpFacilitatorClient` parses a non-2xx body and, when it finds `isValid`, raises a
 * `VerifyError` carrying `invalidReason` through to the caller. A bare `{ error: ... }`
 * body would lose the machine-readable code at that boundary.
 *
 * @param rejection - The wrapper rejection to render.
 * @returns A `VerifyResponse` with the code in `invalidReason`.
 */
function rejectionAsVerifyResponse(rejection: WalrasRejection): VerifyResponse {
  return {
    isValid: false,
    invalidReason: rejection.code,
    invalidMessage: rejection.reason,
  };
}

/**
 * Renders a wrapper-level rejection in `SettleResponse` shape.
 *
 * @param rejection - The wrapper rejection to render.
 * @param network - Network to report; the request's when readable, else the configured one.
 * @returns A `SettleResponse` with the code in `errorReason` and an empty transaction hash.
 */
function rejectionAsSettleResponse(rejection: WalrasRejection, network: Network): SettleResponse {
  return {
    success: false,
    errorReason: rejection.code,
    errorMessage: rejection.reason,
    // Spec section 5.3.2: `transaction` is required, and is the empty string on failure.
    transaction: "",
    network,
  };
}

/**
 * Best-effort read of the network named by a request, for error responses only.
 *
 * @param request - The incoming request.
 * @param fallback - Network to use when the body does not name one.
 * @returns The network from `paymentRequirements`, else from `paymentPayload.accepted`, else the fallback.
 */
function networkFromRequest(request: FastifyRequest, fallback: Network): Network {
  const body: unknown = request.body;
  if (!isObject(body)) return fallback;

  const requirements = body.paymentRequirements;
  if (isObject(requirements) && typeof requirements.network === "string") {
    return requirements.network as Network;
  }

  const payload = body.paymentPayload;
  if (isObject(payload) && isObject(payload.accepted) && typeof payload.accepted.network === "string") {
    return payload.accepted.network as Network;
  }

  return fallback;
}

export interface BuildServerOptions {
  /** Validated configuration. */
  config: FacilitatorConfig;
  /**
   * Facilitator core to serve. Defaults to one built from `config`; tests inject a
   * pre-built core to exercise the HTTP surface against a stub scheme.
   */
  facilitator?: x402Facilitator;
  /**
   * Catalog store to serve. Defaults to one opened at `config.dbPath`; tests inject
   * an in-memory or deliberately broken store. Whatever is used is closed with the
   * server.
   */
  bazaarStore?: BazaarStore;
  /** Fastify logger setting. Defaults to off, so tests stay quiet. */
  logger?: boolean;
}

/**
 * Parses the `GET /discovery/resources` query string into store filters.
 *
 * Split of responsibilities, per FACTS F-025: values that cannot be
 * *interpreted* (non-numeric limit/offset, repeated parameters) are named
 * 400s; values that are merely out of *range* are clamped to the spec bounds
 * (limit 1–100, default 20; offset ≥ 0, default 0), which is where the spec's
 * documented defaults live. String filters pass through verbatim — a value
 * that matches nothing is an empty result, not an error.
 *
 * @param query - Fastify's parsed query object.
 * @returns Store-ready list parameters.
 * @throws {WalrasRejection} When a parameter cannot be interpreted.
 */
function parseListQuery(query: Record<string, unknown>): ListParams {
  const params: ListParams = {};

  const readString = (key: "type" | "payTo" | "scheme" | "network" | "extensions"): void => {
    const raw = query[key];
    if (raw === undefined) return;
    if (typeof raw !== "string") {
      throw new WalrasRejection("walras_invalid_query_parameter", {
        detail: `Parameter '${key}' must appear at most once.`,
      });
    }
    params[key] = raw;
  };
  readString("type");
  readString("payTo");
  readString("scheme");
  readString("network");
  readString("extensions");

  const readCount = (key: "limit" | "offset"): number | undefined => {
    const raw = query[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      throw new WalrasRejection("walras_invalid_query_parameter", {
        detail: `Parameter '${key}' must be a non-negative integer, got ${JSON.stringify(raw)}.`,
      });
    }
    return Number.parseInt(raw, 10);
  };
  const limit = readCount("limit");
  if (limit !== undefined) params.limit = clampLimit(limit);
  const offset = readCount("offset");
  if (offset !== undefined) params.offset = offset;

  return params;
}

/**
 * Builds the facilitator HTTP server.
 *
 * Routes — the x402 v2 spec section 7 payment surface plus the bazaar
 * discovery list endpoint (spec `specs/extensions/bazaar.md` §Optional
 * Discovery Endpoints):
 *
 * | Method | Path                    | Purpose                                    |
 * | ------ | ----------------------- | ------------------------------------------ |
 * | POST   | `/verify`               | Verify a payment without broadcasting it   |
 * | POST   | `/settle`               | Settle a payment on-chain                  |
 * | GET    | `/supported`            | Advertise kinds, extensions, and signers   |
 * | GET    | `/discovery/resources`  | Browse the settle-gated resource catalog   |
 * | GET    | `/health`               | Operational readiness (not part of x402)   |
 *
 * @param options - Server construction options.
 * @returns A Fastify instance, not yet listening.
 */
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config } = options;
  const facilitator = options.facilitator ?? buildFacilitator(config);
  const bazaarStore = options.bazaarStore ?? new BazaarStore(config.dbPath);

  const app = Fastify({ logger: options.logger ?? false });

  app.addHook("onClose", async () => {
    try {
      bazaarStore.close();
    } catch {
      // An already-closed store (e.g. a test's broken-store injection) is fine.
    }
  });

  // Take over JSON parsing so a malformed body becomes a named x402-shaped rejection
  // rather than Fastify's generic FST_ERR_CTP_INVALID_JSON_BODY envelope.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body: string, done) => {
      if (body.trim().length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        // `undefined` reaches the handler, which reports walras_malformed_request_body.
        done(null, undefined);
      }
    },
  );

  app.post("/verify", async (request, reply) => {
    let envelope: FacilitatorRequestBody;
    try {
      envelope = parseEnvelope(request.body);
      assertSupportedKind(facilitator, envelope.paymentPayload, envelope.paymentRequirements);
    } catch (error) {
      if (error instanceof WalrasRejection) {
        return reply.code(error.httpStatus).send(rejectionAsVerifyResponse(error));
      }
      throw error;
    }

    const result = await facilitator.verify(envelope.paymentPayload, envelope.paymentRequirements);

    // A protocol-level rejection is a successful exchange about an invalid payment, so
    // it is a 200 carrying `isValid: false` — matching the reference facilitator and
    // spec section 7.1's "Error Response" example. 4xx is reserved for requests this
    // facilitator could not interpret as an x402 exchange at all.
    return reply.code(200).send(withVerifyReason(result));
  });

  app.post("/settle", async (request, reply) => {
    let envelope: FacilitatorRequestBody;
    try {
      envelope = parseEnvelope(request.body);
      assertSupportedKind(facilitator, envelope.paymentPayload, envelope.paymentRequirements);
    } catch (error) {
      if (error instanceof WalrasRejection) {
        return reply
          .code(error.httpStatus)
          .send(rejectionAsSettleResponse(error, networkFromRequest(request, config.network)));
      }
      throw error;
    }

    // No pre-verification here, by design. FACTS F-036: settle MUST verify independently
    // and MUST NOT assume prior verification — and `ExactStellarScheme.settle()` already
    // runs the full verify as its first step. Calling verify here would double every
    // simulation for no added safety.
    const result = await facilitator.settle(envelope.paymentPayload, envelope.paymentRequirements);

    // Settle-gated cataloging (DECISIONS D-004): only a payment that actually
    // settled on-chain can touch the catalog. The hook runs after the
    // settlement outcome is already decided, and nothing it does can change
    // that outcome: the indexer never throws by contract, and this belt-and-
    // braces catch holds the invariant even against a bug in the hook glue
    // itself (DECISIONS D-015 — a broken indexer degrades discovery, never
    // payments). Its outcome only ever decorates the response with the
    // EXTENSION-RESPONSES header (FACTS F-024), omitted on internal faults.
    if (result.success) {
      try {
        const startedAt = performance.now();
        const outcome = indexSettledPayment(
          bazaarStore,
          envelope.paymentPayload,
          envelope.paymentRequirements,
          new Date().toISOString(),
        );
        const elapsedMs = performance.now() - startedAt;
        if (outcome.status === "error") {
          request.log.warn({ err: outcome.error }, "bazaar indexing failed; settlement unaffected");
        }
        if (elapsedMs > INDEX_BUDGET_MS) {
          request.log.warn({ elapsedMs }, "bazaar indexing exceeded its soft budget");
        }
        const header = encodeExtensionResponses(outcome);
        if (header !== undefined) {
          void reply.header("EXTENSION-RESPONSES", header);
        }
      } catch (error) {
        request.log.warn({ err: error }, "bazaar indexing hook failed; settlement unaffected");
      }
    }

    return reply.code(200).send(withSettleReason(result));
  });

  app.get("/discovery/resources", async (request, reply) => {
    // Spec shape throughout (FACTS F-025, F-027): seven filters in, an
    // `items` array out (never `resources` — that name belongs to search,
    // DECISIONS D-001), pagination as {limit, offset, total}.
    let params: ListParams;
    try {
      params = parseListQuery(request.query as Record<string, unknown>);
    } catch (error) {
      if (error instanceof WalrasRejection) {
        return reply
          .code(error.httpStatus)
          .send({ error: { code: error.code, reason: error.reason } });
      }
      throw error;
    }
    return reply.code(200).send(toListResponse(bazaarStore.list(params)));
  });

  app.get("/supported", async (_request, reply) => {
    // Straight from the facilitator core: `kinds`, `extensions`, and `signers` are all
    // required (FACTS F-040), and the Stellar kind carries `extra.areFeesSponsored`
    // because `ExactStellarScheme.getExtra()` supplies it (FACTS F-041, F-044).
    return reply.code(200).send(facilitator.getSupported());
  });

  app.get("/health", async (_request, reply) => {
    return reply.code(200).send({
      status: "ok",
      x402Version: X402_VERSION,
      ...describeConfig(config),
    });
  });

  app.setNotFoundHandler(async (_request, reply) => {
    const rejection = new WalrasRejection("walras_unknown_route", { httpStatus: 404 });
    return reply.code(404).send({ error: { code: rejection.code, reason: rejection.reason } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ err: error }, "unhandled facilitator error");
    const rejection = new WalrasRejection("walras_internal_error", { httpStatus: 500 });

    if (request.url.startsWith("/verify")) {
      return reply.code(500).send(rejectionAsVerifyResponse(rejection));
    }
    if (request.url.startsWith("/settle")) {
      return reply
        .code(500)
        .send(rejectionAsSettleResponse(rejection, networkFromRequest(request, config.network)));
    }
    return reply.code(500).send({ error: { code: rejection.code, reason: rejection.reason } });
  });

  return app;
}
