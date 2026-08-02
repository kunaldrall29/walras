import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describeConfig, loadConfig, ConfigError } from "./config.js";
import { buildServer } from "./server.js";

export { loadConfig, describeConfig, ConfigError } from "./config.js";
export type { FacilitatorConfig, FeeMode, Env } from "./config.js";
export { buildFacilitator } from "./facilitator.js";
export { buildServer } from "./server.js";
export type { BuildServerOptions } from "./server.js";
export * from "./errors.js";

/**
 * Loads `.env` from the repository root when present, without adding a dependency.
 *
 * Real environment variables win: `process.loadEnvFile` does not overwrite variables
 * that are already set, so a value passed on the command line beats the file.
 *
 * @param path - Path to the env file.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}

/**
 * Boots the facilitator: load configuration, build the server, listen.
 *
 * @returns Resolves once the server is accepting connections.
 */
async function main(): Promise<void> {
  loadEnvFile(resolve(process.cwd(), ".env"));
  loadEnvFile(resolve(process.cwd(), "../../.env"));

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`walras facilitator: invalid configuration — ${error.message}`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const app = buildServer({ config, logger: true });
  await app.listen({ port: config.port, host: "0.0.0.0" });

  app.log.info(describeConfig(config), "walras facilitator ready");
}

// Only boot when executed directly, so importing the package in tests binds no port.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
