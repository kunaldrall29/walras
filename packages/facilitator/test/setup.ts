import { Config } from "@stellar/stellar-sdk";

/**
 * Bounds the one network call the tests cannot redirect.
 *
 * `ExactStellarScheme` derives its ledger-close-time estimate through
 * `getEstimatedLedgerCloseTimeSeconds`, which talks to a hard-coded Horizon URL — there is
 * no RpcConfig knob for it, so the RPC double cannot intercept it. The function already
 * falls back to 5 seconds on any error (FACTS F-034), and the fixtures are built to stay
 * valid across every estimate from 1 to 10 seconds, so the result does not change what the
 * tests assert. A short timeout only stops an offline or slow CI run from hanging on it.
 */
Config.setTimeout(5_000);
