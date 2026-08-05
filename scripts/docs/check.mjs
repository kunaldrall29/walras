#!/usr/bin/env node
/**
 * `pnpm docs:check` — the documentation gate. Fails on:
 *
 *   1. Generator drift — a committed generated artifact differs from what the
 *      generators produce from the current code (rule R3).
 *   2. Invalid OpenAPI — `redocly lint` on docs/api/openapi.yaml.
 *   3. Stale SVGs — a diagram source whose committed SVG was rendered from
 *      different bytes (rule R6; hash marker, see render-diagrams.mjs).
 *   4. Dead links — markdown-link-check over the doc set.
 *   5. Claims audit — banned marketing words anywhere; capability claims
 *      ("works", "passes", "proven", "measured") on lines with no EVIDENCE
 *      reference (rule R2); dates inside roadmap sections; normative docs with
 *      no FACTS/DECISIONS citations at all (rule R1).
 *
 * Flags: --skip-links (offline runs), --skip-drift (when dists are stale on
 * purpose). CI runs the full gate.
 */
import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DIAGRAMS = resolve(REPO_ROOT, "docs", "diagrams");
const skipLinks = process.argv.includes("--skip-links");
const skipDrift = process.argv.includes("--skip-drift");

const failures = [];

/**
 * Records a gate failure.
 *
 * @param area - Which check failed.
 * @param message - What went wrong, with enough context to fix it.
 */
function fail(area, message) {
  failures.push(`[${area}] ${message}`);
}

// ---------------------------------------------------------------------------
// 1. Generator drift
// ---------------------------------------------------------------------------

const GENERATED = [
  "docs/api/openapi.yaml",
  "docs/reference/config.md",
  "docs/reference/errors.md",
  "docs/diagrams/catalog-erd.mmd",
];

if (!skipDrift) {
  const backup = mkdtempSync(join(tmpdir(), "walras-docs-check-"));
  const before = new Map();
  for (const rel of GENERATED) {
    const abs = resolve(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      fail("drift", `${rel} is missing — run pnpm docs:gen`);
      continue;
    }
    const safe = rel.replaceAll("/", "__");
    copyFileSync(abs, join(backup, safe));
    before.set(rel, readFileSync(abs, "utf8"));
  }

  for (const step of ["gen-openapi.mjs", "gen-config.mjs", "gen-errors.mjs", "gen-erd.mjs"]) {
    const result = spawnSync(process.execPath, [join(HERE, step)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      fail("drift", `${step} failed:\n${result.stderr || result.stdout}`);
    }
  }

  for (const [rel, previous] of before) {
    const now = readFileSync(resolve(REPO_ROOT, rel), "utf8");
    if (now !== previous) {
      fail(
        "drift",
        `${rel} was stale — the generators produced different content from the current ` +
          `code. The regenerated file is now in place; review and commit it.`,
      );
    }
  }
  rmSync(backup, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 2. OpenAPI lint
// ---------------------------------------------------------------------------

{
  const redocly = resolve(REPO_ROOT, "node_modules", ".bin", "redocly");
  const result = spawnSync(redocly, ["lint", "docs/api/openapi.yaml", "--format", "stylish"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("openapi", `redocly lint failed:\n${result.stdout}\n${result.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Stale SVGs
// ---------------------------------------------------------------------------

{
  const diagramDirs = [DIAGRAMS, resolve(REPO_ROOT, "docs", "scf")].filter(existsSync);
  const sources = diagramDirs.flatMap(dir =>
    readdirSync(dir)
      .filter(name => name.endsWith(".mmd"))
      .map(name => ({ dir, name })),
  );
  if (sources.length === 0) fail("diagrams", `no .mmd sources in ${diagramDirs.join(", ")}`);
  for (const { dir, name } of sources) {
    const svgPath = join(dir, name.replace(/\.mmd$/, ".svg"));
    if (!existsSync(svgPath)) {
      fail("diagrams", `${name} has no rendered SVG — run pnpm docs:gen`);
      continue;
    }
    const hash = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
    const marker = readFileSync(svgPath, "utf8").match(
      /<!-- mmd-source-sha256:([0-9a-f]{64}) -->/,
    );
    if (!marker) {
      fail("diagrams", `${svgPath} carries no source-hash marker — run pnpm docs:gen`);
    } else if (marker[1] !== hash) {
      fail("diagrams", `${name} changed after its SVG was rendered — run pnpm docs:gen`);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared doc-set enumeration
// ---------------------------------------------------------------------------

/**
 * Recursively lists markdown files under a directory.
 *
 * @param dir - Absolute directory.
 * @returns Absolute file paths.
 */
function markdownFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFilesUnder(abs));
    else if (entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

const ROOT_DOCS = ["README.md", "SECURITY.md", "CONTRIBUTING.md"]
  .map(name => resolve(REPO_ROOT, name))
  .filter(existsSync);
const ALL_DOCS = [...markdownFilesUnder(resolve(REPO_ROOT, "docs")), ...ROOT_DOCS];

/** Verbatim external capture — exempt from every authored-content rule. */
const VERBATIM = new Set([resolve(REPO_ROOT, "docs", "rfp.md")]);
/** The evidence ledgers themselves — capability claims here ARE the evidence. */
const LEDGERS = new Set(
  ["FACTS.md", "EVIDENCE.md", "DECISIONS.md"].map(name => resolve(REPO_ROOT, "docs", name)),
);

// ---------------------------------------------------------------------------
// 4. Link check
// ---------------------------------------------------------------------------

if (!skipLinks) {
  const linkCheck = resolve(REPO_ROOT, "node_modules", ".bin", "markdown-link-check");
  const config = join(HERE, "link-check.json");
  for (const file of ALL_DOCS) {
    const result = spawnSync(linkCheck, ["-q", "-c", config, file], {
      cwd: dirname(file),
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      fail(
        "links",
        `${relative(REPO_ROOT, file)}:\n${(result.stdout || "").trim()}\n${(result.stderr || "").trim()}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Claims audit
// ---------------------------------------------------------------------------

const BANNED_WORDS =
  /\b(seamless(?:ly)?|blazing(?:ly)?|revolutionar\w+|revolutioniz\w+|game.chang\w+|cutting.edge|world.class|best.in.class|state.of.the.art|next.generation|unparalleled|groundbreaking|effortless(?:ly)?)\b/i;

/** Capability-claim words that demand an EVIDENCE reference in the same paragraph. */
const CAPABILITY = /\b(works|working|passes|passed|proven|measured|timed)\b/i;
/** What counts as an evidence reference (rule R2). */
const EVIDENCE_REF = /EVIDENCE|S\d-\d|\bF-\d{3}\b/;
/** Explanatory usages that are not capability claims. */
const CAPABILITY_EXEMPT = [
  /\bhow\b[^.]*\bworks\b/i, // "how the pipeline works"
  /\bworks\b[^.]*\bas follows\b/i,
  /\bworking director(y|ies)\b/i,
  /\bworking name\b/i,
  /\bpass(?:ed|es)? through\b/i, // taxonomy passthrough is design, not capability
  /\bnot yet (proven|measured|passed|working)\b/i,
];
/** Generated files: capability wording there is runtime text, not authored claims. */
const GENERATED_DOC_DIRS = ["docs/reference/", "docs/api/", "docs/diagrams/"].map(rel =>
  resolve(REPO_ROOT, rel),
);

/** Files that must cite FACTS/DECISIONS rows at least once (rule R1 floor). */
const NORMATIVE = [
  "docs/ARCHITECTURE.md",
  "docs/MODELS.md",
  "docs/THREAT-MODEL.md",
  "docs/quickstart.md",
  "docs/runbook.md",
  "docs/glossary.md",
  "docs/faq.md",
  "docs/guides/sell.md",
  "docs/guides/buy-agent.md",
  "docs/guides/operate.md",
  "docs/litepaper/walras-litepaper.md",
]
  .map(rel => resolve(REPO_ROOT, rel))
  .filter(existsSync);

const MONTHS =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

for (const file of ALL_DOCS) {
  if (VERBATIM.has(file)) continue;
  const rel = relative(REPO_ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  let inRoadmap = false;
  let roadmapLevel = 0;

  lines.forEach((line, index) => {
    const where = `${rel}:${index + 1}`;

    const banned = line.match(BANNED_WORDS);
    if (banned) fail("claims", `${where} uses banned word '${banned[0]}': ${line.trim()}`);

    const heading = line.match(/^(#+)\s+(.*)/);
    if (heading) {
      if (/roadmap/i.test(heading[2])) {
        inRoadmap = true;
        roadmapLevel = heading[1].length;
      } else if (inRoadmap && heading[1].length <= roadmapLevel) {
        inRoadmap = false;
      }
    }
    if (inRoadmap && (/\b20\d{2}\b/.test(line) || MONTHS.test(line) || /\bQ[1-4]\s/.test(line))) {
      fail("claims", `${where} dates a roadmap item (rule R2 — no dates in roadmaps): ${line.trim()}`);
    }
  });

  // Capability gate — paragraph-scoped: a citation belongs to the sentence, and
  // markdown wraps sentences across lines, so the audit unit is the paragraph
  // (consecutive non-blank lines). Ledgers and generated files are exempt: the
  // former ARE the evidence, the latter carry runtime text from code.
  if (LEDGERS.has(file)) continue;
  if (GENERATED_DOC_DIRS.some(dir => file.startsWith(dir))) continue;
  let start = 0;
  while (start < lines.length) {
    while (start < lines.length && lines[start].trim() === "") start += 1;
    let end = start;
    while (end < lines.length && lines[end].trim() !== "") end += 1;
    if (end > start) {
      const paragraph = lines.slice(start, end).join(" ");
      if (
        CAPABILITY.test(paragraph) &&
        !EVIDENCE_REF.test(paragraph) &&
        !CAPABILITY_EXEMPT.some(pattern => pattern.test(paragraph))
      ) {
        fail(
          "claims",
          `${rel}:${start + 1} paragraph makes a capability claim with no EVIDENCE reference: ${lines[start].trim()}`,
        );
      }
    }
    start = end;
  }
}

for (const file of NORMATIVE) {
  const text = readFileSync(file, "utf8");
  if (!/\b[FDQ]-\d{3}\b/.test(text)) {
    fail(
      "claims",
      `${relative(REPO_ROOT, file)} cites no FACTS/DECISIONS rows at all (rule R1)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`docs:check — ${failures.length} failure(s):\n`);
  for (const failure of failures) console.error(`  ${failure}\n`);
  process.exit(1);
}
console.log(
  `docs:check — PASS (drift${skipDrift ? " skipped" : ""}, openapi, diagrams, links${
    skipLinks ? " skipped" : ""
  }, claims) across ${ALL_DOCS.length} markdown files`,
);
