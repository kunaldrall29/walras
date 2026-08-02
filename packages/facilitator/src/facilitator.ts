import { BAZAAR } from "@walras/bazaar";
import { x402Facilitator } from "@x402/core/facilitator";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import type { FacilitatorConfig } from "./config.js";

/**
 * Builds the x402 facilitator core with the Stellar `exact` scheme registered.
 *
 * walras adds **zero** payment validation of its own (FACTS F-045): `ExactStellarScheme`
 * already enforces every MUST in `specs/schemes/exact/scheme_exact_stellar.md` and emits
 * 37 machine-readable reason codes doing it. This function's whole job is to translate
 * operator configuration into the scheme's constructor arguments.
 *
 * The `bazaar` extension is registered here, so `GET /supported` advertises it — in
 * the same change that mounted `GET /discovery/resources` and the settle-time indexing
 * hook, exactly as DECISIONS D-016 required: never advertised before reachable, and
 * not left unadvertised once it is. The hook itself lives in the HTTP layer
 * (server.ts), off the settlement path, per DECISIONS D-015.
 *
 * @param config - Validated facilitator configuration.
 * @returns A facilitator core ready to serve verify, settle, and supported.
 */
export function buildFacilitator(config: FacilitatorConfig): x402Facilitator {
  const signers = config.submitterSecrets.map(secret =>
    createEd25519Signer(secret, config.network),
  );

  // DECISIONS D-012: the reference operator settles via a fee-bump with a dedicated fee
  // account (FACTS F-055). Configuring one is a config change, not an engineering change.
  const feeBumpSigner =
    config.feeBumpSecret === undefined
      ? undefined
      : createEd25519Signer(config.feeBumpSecret, config.network);

  const scheme = new ExactStellarScheme(signers, {
    rpcConfig: { url: config.rpcUrl },
    // Network fees are always sponsored by the submitter account (FACTS F-006, F-041).
    // This is distinct from `FEE_MODE`, which governs whether walras charges a *service*
    // fee on top; both are currently free.
    areFeesSponsored: true,
    maxTransactionFeeStroops: config.maxTransactionFeeStroops,
    ...(feeBumpSigner === undefined ? {} : { feeBumpSigner }),
  });

  return new x402Facilitator().register(config.network, scheme).registerExtension(BAZAAR);
}
