import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Tool-call round-trips run real MCP protocol over linked in-memory
    // transports plus node:http doubles; generous timeout for slow CI.
    testTimeout: 20_000,
  },
});
