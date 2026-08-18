import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Fixture-driven verification exercises the real ExactStellarScheme against an
    // in-process Soroban RPC double; a generous timeout absorbs the one hard-coded
    // Horizon call the package makes for its ledger-close-time estimate (F-034).
    testTimeout: 20_000,
  },
});
