import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIG_REFERENCE, loadConfig } from "../src/config.js";

const CONFIG_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/config.ts"),
  "utf8",
);

/**
 * CONFIG_REFERENCE is the single source this server's slice of
 * docs/reference/config.md is generated from (writing rule R3). Drift between
 * the table and loadConfig fails the build, not the documentation.
 */
describe("CONFIG_REFERENCE stays in lockstep with loadConfig", () => {
  const documented = new Set(CONFIG_REFERENCE.map(entry => entry.name));

  it("documents every environment variable loadConfig reads", () => {
    const loaderSource = CONFIG_SOURCE.slice(CONFIG_SOURCE.indexOf("export function loadConfig"));
    const reads = [...loaderSource.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map(m => m[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const name of reads) {
      expect(documented, `loadConfig reads ${name} but CONFIG_REFERENCE omits it`).toContain(name);
    }
  });

  it("documents no variable loadConfig does not read", () => {
    for (const name of documented) {
      expect(
        CONFIG_SOURCE.includes(`env.${name}`),
        `CONFIG_REFERENCE documents ${name} but loadConfig never reads it`,
      ).toBe(true);
    }
  });

  it("renders defaults that match what loadConfig actually produces", () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const byName = new Map(CONFIG_REFERENCE.map(entry => [entry.name, entry]));
    expect(byName.get("FACILITATOR_URL")?.defaultValue).toBe(config.facilitatorUrl);
    expect(byName.get("WALRAS_MCP_NETWORK")?.defaultValue).toBe(config.network);
    expect(byName.get("WALRAS_MCP_MAX_AMOUNT")?.defaultValue).toContain(String(config.maxAmount));
    expect(byName.get("CLIENT_STELLAR_PRIVATE_KEY")?.defaultValue).toBeNull();
  });
});
