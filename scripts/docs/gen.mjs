#!/usr/bin/env node
/**
 * `pnpm docs:gen` — regenerates every artifact that is generated from code
 * (writing rule R3) and re-renders any diagram whose SVG is stale (rule R6):
 *
 *   docs/api/openapi.yaml         ← Fastify route schemas (routeSchemas.ts)
 *   docs/reference/config.md      ← CONFIG_REFERENCE tables (config.ts × 2)
 *   docs/reference/errors.md      ← error enumerations (errors.ts × 2, reasons.ts)
 *   docs/diagrams/catalog-erd.mmd ← SCHEMA_SQL via PRAGMA introspection
 *   docs/diagrams/*.svg           ← docs/diagrams/*.mmd
 *
 * Builds the workspace first when a dist is missing (the generators import
 * built output, never TypeScript source).
 */
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

const DISTS = [
  "packages/facilitator/dist/index.js",
  "packages/bazaar/dist/index.js",
  "packages/mcp-server/dist/index.js",
];
if (DISTS.some(dist => !existsSync(resolve(REPO_ROOT, dist)))) {
  console.log("docs:gen — dist missing, running pnpm build first");
  const build = spawnSync("pnpm", ["-r", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const steps = ["gen-openapi.mjs", "gen-config.mjs", "gen-errors.mjs", "gen-erd.mjs", "render-diagrams.mjs"];
const extraArgs = process.argv.slice(2);
for (const step of steps) {
  const args = [join(HERE, step)];
  if (step === "render-diagrams.mjs") args.push(...extraArgs);
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`docs:gen — ${step} failed`);
    process.exit(result.status ?? 1);
  }
}
console.log("docs:gen — all generators completed");
