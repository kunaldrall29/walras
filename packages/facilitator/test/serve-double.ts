/**
 * Runs the facilitator against the in-process Soroban RPC double, on a real port.
 *
 * This exists so the deterministic cases can be captured as genuine curl transcripts
 * rather than only as test assertions. Against live testnet every simulation-dependent
 * fixture returns `invalid_exact_stellar_payload_simulation_failed`, because the buyer
 * holds no USDC (FACTS Q-011) — so a live transcript cannot tell a valid payload from a
 * tampered one. This can.
 *
 * Results captured through it are modelled, not observed on-chain (DECISIONS D-017).
 *
 *   npx tsx test/serve-double.ts [port]
 */
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { fixtureSubmitterKeypair, fixtures } from "./helpers/harness.js";
import { startSorobanRpcDouble } from "./helpers/soroban-rpc-double.js";

const port = Number.parseInt(process.argv[2] ?? "4031", 10);

const rpc = await startSorobanRpcDouble({
  networkPassphrase: fixtures.networkPassphrase,
  latestLedger: fixtures.rpcCapture.getLatestLedger,
});

const config = loadConfig({
  NETWORK: fixtures.network,
  RPC_URL: rpc.url,
  SUBMITTER_SECRET: fixtureSubmitterKeypair().secret(),
  PORT: String(port),
});

const app = buildServer({ config });
await app.listen({ port, host: "127.0.0.1" });

console.log(`facilitator on http://127.0.0.1:${port} (Soroban RPC double at ${rpc.url})`);
console.log(`submitter ${config.submitterAddresses[0]}  ledger ${fixtures.baseLedger}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => rpc.close()).then(() => process.exit(0));
  });
}
