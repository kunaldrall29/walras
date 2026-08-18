#!/usr/bin/env node
/**
 * Builds the static documentation site (docs.walras.space) into dist-site/.
 *
 * Deliberately small and deterministic: markdown-it (MIT, license-checked per
 * gate GD.3) plus one template, no client-side JavaScript. Every relative link
 * is resolved against the repository tree at build time and rewritten to one of:
 * a rendered page, a copied asset (SVGs, .mmd sources, openapi.yaml), or a
 * GitHub URL for source files that are not part of the site — so the site can
 * never ship a link the repository does not back. In-document ```mermaid
 * fences render to SVGs at build time via the same mmdc path as
 * render-diagrams.mjs, falling back to the fenced source when mmdc cannot run.
 *
 * Run: node scripts/docs/build-site.mjs   (requires committed docs — it reads
 * the working tree; the footer stamps the current HEAD commit).
 */
import { execSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(REPO_ROOT, "dist-site");
const GITHUB = "https://github.com/kunaldrall29/walras";
const BRANCH = "session-0-verification";
const COMMIT = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT }).toString().trim();
// Same renderer render-diagrams.mjs uses for the committed SVGs.
const MMDC = join(REPO_ROOT, "node_modules", ".bin", "mmdc");
const PUPPETEER_CONFIG = join(REPO_ROOT, "scripts", "docs", "puppeteer-config.json");

/** repo-relative markdown source → site route (root-absolute, .html). */
const PAGES = new Map([
  ["README.md", "/index.html"],
  ["docs/walras-technical-architecture.md", "/technical-architecture.html"],
  ["SECURITY.md", "/security.html"],
  ["CONTRIBUTING.md", "/contributing.html"],
  ["docs/quickstart.md", "/quickstart.html"],
  ["docs/faq.md", "/faq.html"],
  ["docs/glossary.md", "/glossary.html"],
  ["docs/guides/sell.md", "/guides/sell.html"],
  ["docs/guides/buy-agent.md", "/guides/buy-agent.html"],
  ["docs/guides/operate.md", "/guides/operate.html"],
  ["docs/runbook.md", "/runbook.html"],
  ["docs/ARCHITECTURE.md", "/architecture.html"],
  ["docs/MODELS.md", "/models.html"],
  ["docs/THREAT-MODEL.md", "/threat-model.html"],
  ["docs/litepaper/walras-litepaper.md", "/litepaper/index.html"],
  ["docs/litepaper/ABSTRACT.md", "/litepaper/abstract.html"],
  ["docs/reference/config.md", "/reference/config.html"],
  ["docs/reference/errors.md", "/reference/errors.html"],
  ["docs/FACTS.md", "/facts.html"],
  ["docs/DECISIONS.md", "/decisions.html"],
  ["docs/EVIDENCE.md", "/evidence.html"],
  ["docs/scf/stack-explanation.md", "/scf/stack-explanation.html"],
  ["docs/scf/decentralization.md", "/scf/decentralization.html"],
  ["docs/scf/infrastructure.md", "/scf/infrastructure.html"],
  ["docs/scf/privacy.md", "/scf/privacy.html"],
  ["docs/scf/maintenance.md", "/scf/maintenance.html"],
  ["docs/scf/licensing.md", "/scf/licensing.html"],
]);

/** repo-relative asset directories copied verbatim. */
const ASSET_DIRS = new Map([
  ["docs/diagrams", "/diagrams"],
  ["docs/api", "/api"],
]);
/** individual asset files (repo-relative → site path). */
const ASSET_FILES = new Map([
  ["docs/scf/high-level-diagram.mmd", "/scf/high-level-diagram.mmd"],
  ["docs/scf/high-level-diagram.svg", "/scf/high-level-diagram.svg"],
]);

/** Sidebar: group title → [site route, label]. */
const NAV = [
  ["Start", [
    ["/index.html", "Overview"],
    ["/technical-architecture.html", "ARCHITECTURE · MD"],
    ["/quickstart.html", "Quickstart"],
    ["/faq.html", "FAQ"],
    ["/glossary.html", "Glossary"],
  ]],
  ["Guides", [
    ["/guides/sell.html", "Sell"],
    ["/guides/buy-agent.html", "Buy / agent"],
    ["/guides/operate.html", "Operate"],
    ["/runbook.html", "Runbook"],
  ]],
  ["Design", [
    ["/architecture.html", "Architecture"],
    ["/models.html", "Models"],
    ["/threat-model.html", "Threat model"],
    ["/litepaper/index.html", "Litepaper"],
    ["/litepaper/abstract.html", "Abstract"],
  ]],
  ["Reference", [
    ["/reference/config.html", "Configuration"],
    ["/reference/errors.html", "Error registry"],
    ["/api/openapi.yaml", "OpenAPI (YAML)"],
  ]],
  ["Ledgers", [
    ["/facts.html", "FACTS"],
    ["/decisions.html", "DECISIONS"],
    ["/evidence.html", "Evidence"],
  ]],
  ["Project", [
    ["/security.html", "Security policy"],
    ["/contributing.html", "Contributing"],
    ["/scf/stack-explanation.html", "SCF snippets"],
  ]],
];

/**
 * Converts an on-disk route to the clean URL it is served under. Files keep
 * their .html names in dist-site/; every emitted link drops the extension and
 * dist-site/vercel.json ships `cleanUrls: true`, so Vercel serves the clean
 * path and 308-redirects any old `.html` deep link onto it. Non-.html routes
 * (e.g. /api/openapi.yaml) pass through untouched.
 *
 * @param route - Site route as stored in PAGES/NAV (root-absolute, .html).
 * @returns The extensionless URL to emit in hrefs.
 */
function cleanRoute(route) {
  if (route.endsWith("/index.html")) return route.slice(0, -"index.html".length);
  return route.endsWith(".html") ? route.slice(0, -".html".length) : route;
}

/**
 * Derives a stable heading id, GitHub-style.
 *
 * @param text - Heading text.
 * @returns Slug id.
 */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Rewrites one markdown href from a given source file to a site URL.
 *
 * @param href - The raw href from the markdown.
 * @param sourceRel - Repo-relative path of the markdown file it appears in.
 * @returns The rewritten URL.
 */
function rewriteHref(href, sourceRel) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [pathPart, anchor] = href.split("#");
  const abs = resolve(REPO_ROOT, dirname(sourceRel), pathPart);
  const repoRel = abs.startsWith(REPO_ROOT + sep)
    ? abs.slice(REPO_ROOT.length + 1).split(sep).join(posix.sep)
    : null;
  const suffix = anchor ? `#${anchor}` : "";

  if (repoRel === null) {
    throw new Error(`${sourceRel}: link escapes the repository: ${href}`);
  }
  if (PAGES.has(repoRel)) return cleanRoute(PAGES.get(repoRel)) + suffix;
  for (const [dir, sitePath] of ASSET_DIRS) {
    if (repoRel.startsWith(dir + "/")) return sitePath + repoRel.slice(dir.length) + suffix;
  }
  if (ASSET_FILES.has(repoRel)) return ASSET_FILES.get(repoRel) + suffix;
  if (!existsSync(abs)) {
    throw new Error(`${sourceRel}: link target missing from the repository: ${href}`);
  }
  const kind = repoRel.includes(".") ? "blob" : "tree";
  return `${GITHUB}/${kind}/${BRANCH}/${repoRel}`;
}

const md = new MarkdownIt({ html: true, linkify: false });

/**
 * Evidence-section anchor map: "S5-5" → the heading slug on /evidence.html.
 * Built from EVIDENCE.md's own headings so links cannot dangle.
 */
const EVIDENCE_ANCHORS = new Map();
for (const line of readFileSync(join(REPO_ROOT, "docs/EVIDENCE.md"), "utf8").split("\n")) {
  const match = line.match(/^#{2,3}\s+(S\d+-\d+)\b(.*)$/);
  if (match) EVIDENCE_ANCHORS.set(match[1], slug(`${match[1]}${match[2]}`));
}

const SREF = /\bEVIDENCE\s+(S\d+-\d+)\b/g;

/**
 * Site-presentation transform for one inline text token (never headings, never
 * code spans): "EVIDENCE S5-5" becomes a bare "S5-5" linked to the evidence
 * page's section, and any remaining standalone "EVIDENCE" is de-shouted to
 * "evidence". The repository markdown keeps its markers untouched — they are
 * what the claims-audit gate (docs:check rule R2) enforces; this rewrite is
 * rendering only.
 *
 * @param token - A "text" token.
 * @returns Replacement token list.
 */
function transformEvidenceText(token) {
  const Token = token.constructor;
  const out = [];
  let last = 0;
  for (const match of token.content.matchAll(SREF)) {
    const before = token.content.slice(last, match.index);
    if (before) out.push(Object.assign(new Token("text", "", 0), { content: before }));
    const ref = match[1];
    const anchor = EVIDENCE_ANCHORS.get(ref);
    const open = new Token("link_open", "a", 1);
    open.attrSet("href", `/evidence${anchor ? `#${anchor}` : ""}`);
    out.push(open, Object.assign(new Token("text", "", 0), { content: ref }));
    out.push(new Token("link_close", "a", -1));
    last = match.index + match[0].length;
  }
  const tail = token.content.slice(last);
  if (tail) out.push(Object.assign(new Token("text", "", 0), { content: tail }));
  for (const piece of out) {
    if (piece.type === "text") piece.content = piece.content.replace(/\bEVIDENCE\b/g, "evidence");
  }
  return out.length > 0 ? out : [token];
}

// Wide tables (FACTS, the error registry) must scroll inside their own box.
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => "</table></div>";

// Diagrams scale down on small screens; wrapping each image in a link to its
// own SVG gives phones a tap-to-open, pinch-to-zoom full view with no JS.
const renderImage = md.renderer.rules.image.bind(md.renderer.rules);
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = tokens[idx].attrGet("src") ?? "";
  return `<a class="figure" href="${src}">${renderImage(tokens, idx, options, env, self)}</a>`;
};

/**
 * Renders one in-document mermaid source to an SVG under the site's /diagrams
 * tree, exactly the way render-diagrams.mjs renders the committed diagrams
 * (mmdc, headless Chromium per puppeteer-config.json, white background).
 *
 * @param source - Mermaid source text from a fenced block.
 * @param name - Output file name, without extension.
 * @returns Site-absolute SVG path, or null when rendering fails.
 */
function renderMermaidSvg(source, name) {
  if (!existsSync(MMDC)) return null;
  const svgOut = join(OUT, "diagrams", `${name}.svg`);
  mkdirSync(dirname(svgOut), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "walras-site-mmd-"));
  const mmdPath = join(tmp, `${name}.mmd`);
  writeFileSync(mmdPath, source);
  const result = spawnSync(
    MMDC,
    ["-i", mmdPath, "-o", svgOut, "-b", "white", "-p", PUPPETEER_CONFIG, "--quiet"],
    { encoding: "utf8" },
  );
  rmSync(tmp, { recursive: true, force: true });
  if (result.status !== 0 || !existsSync(svgOut)) {
    console.error(
      `build-site: mermaid render failed for ${name} — page falls back to the fenced source`,
    );
    if (result.stderr || result.stdout) console.error((result.stderr || result.stdout).trim());
    return null;
  }
  return `/diagrams/${name}.svg`;
}

// ```mermaid fences render to SVGs at build time and ship as the same
// tap-to-open figures the committed diagrams use. If rendering fails the page
// shows the fenced mermaid source in a normal <pre> — never a broken image.
const renderFence = md.renderer.rules.fence.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim().split(/\s+/)[0] !== "mermaid") {
    return renderFence(tokens, idx, options, env, self);
  }
  env.mermaid = (env.mermaid ?? 0) + 1;
  const src = renderMermaidSvg(token.content, `${env.pageBase}-mermaid-${env.mermaid}`);
  if (src === null) {
    return `<pre class="mermaid-source"><code>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
  }
  return `<a class="figure" href="${src}"><img src="${src}" alt="Diagram ${env.mermaid}, rendered from the mermaid source in this document"></a>\n`;
};

/** The grant document of record — rendered verbatim (see renderPage). */
const ARCH_SOURCE = "docs/walras-technical-architecture.md";

/**
 * Build-supplied front matter for pages whose markdown must stay untouched.
 * The pinned spec commit is confirmed against the docs/FACTS.md header:
 * x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f.
 */
const PAGE_META = new Map([
  [
    ARCH_SOURCE,
    {
      title: "Walras Technical Architecture",
      line:
        `Last updated 2026-08-14 · pinned spec commit <code>17fc989</code> · ` +
        `<a href="https://raw.githubusercontent.com/kunaldrall29/walras/${BRANCH}/${ARCH_SOURCE}">Download .md</a>`,
    },
  ],
]);

/** [BUILT]/[T1]/[T2]/[T3] tranche tokens, with their optional qualifiers. */
const CHIP_TOKEN = /\[(BUILT|T[1-3])((?::| )[^\]]*)?\]/g;

/**
 * Replaces tranche tokens in one text token with status-chip spans. The words
 * inside the brackets are preserved exactly; only the brackets become chip
 * styling. Applies solely to the technical-architecture page.
 *
 * @param token - A "text" token.
 * @returns Replacement token list.
 */
function transformChipText(token) {
  const Token = token.constructor;
  const out = [];
  let last = 0;
  for (const match of token.content.matchAll(CHIP_TOKEN)) {
    const before = token.content.slice(last, match.index);
    if (before) out.push(Object.assign(new Token("text", "", 0), { content: before }));
    const cls = match[1] === "BUILT" ? "chip chip-built" : "chip";
    const label = md.utils.escapeHtml(match[1] + (match[2] ?? ""));
    out.push(
      Object.assign(new Token("html_inline", "", 0), {
        content: `<span class="${cls}">${label}</span>`,
      }),
    );
    last = match.index + match[0].length;
  }
  if (out.length === 0) return [token];
  const tail = token.content.slice(last);
  if (tail) out.push(Object.assign(new Token("text", "", 0), { content: tail }));
  return out;
}

/** Page-scoped styles for the technical-architecture page only. */
const ARCH_STYLE = `
<style>
.page-meta{margin:-.35rem 0 1.8rem;font-size:.85rem;color:var(--muted)}
.chip{display:inline-block;padding:.1em .55em;border:1px solid var(--line);border-radius:999px;background:var(--code-bg);color:var(--muted);font-size:.72em;font-weight:600;line-height:1.6;white-space:nowrap;vertical-align:.1em}
.chip-built{color:var(--accent);border-color:var(--accent)}
.hanchor{margin-left:.45rem;font-weight:400;font-size:.85em;text-decoration:none;color:var(--muted);opacity:0}
h2:hover .hanchor,h3:hover .hanchor,.hanchor:focus{opacity:1}
@media print{
  :root{--bg:#fff;--fg:#000;--muted:#333;--line:#999;--accent:#000;--code-bg:#fff;--side:#fff}
  .sidebar,.topbar{display:none}
  .layout{display:block}
  main{max-width:100%;padding:0}
  body{background:#fff;color:#000}
  a{color:#000}
  .hanchor{display:none}
  a.figure{overflow:visible}
  a.figure img,img{max-width:100%!important;height:auto;border:none;border-radius:0}
  pre{overflow-x:visible;white-space:pre-wrap;border:1px solid #ccc}
  .table-wrap{overflow-x:visible}
  h1,h2,h3{break-after:avoid}
}
</style>`;

/**
 * Renders one markdown source to a full HTML page.
 *
 * @param sourceRel - Repo-relative markdown path.
 * @param route - Site route for the page.
 * @returns Full HTML document.
 */
function renderPage(sourceRel, route) {
  const raw = readFileSync(join(REPO_ROOT, sourceRel), "utf8");
  const env = { pageBase: route.slice(1).replace(/\.html$/, "").split("/").join("-") };
  const tokens = md.parse(raw, env);

  let title = "walras";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open" && token.tag === "h1" && tokens[i + 1]?.type === "inline") {
      title = tokens[i + 1].content.replace(/[`*]/g, "");
      break;
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open" && tokens[i + 1]?.type === "inline") {
      token.attrSet("id", slug(tokens[i + 1].content));
    }
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "link_open") {
        const href = child.attrGet("href");
        if (href) child.attrSet("href", rewriteHref(href, sourceRel));
      }
      if (child.type === "image") {
        const src = child.attrGet("src");
        if (src) child.attrSet("src", rewriteHref(src, sourceRel));
      }
    }
    // Headings keep their document names (the evidence ledger's own title and
    // section ids must survive); body text gets the evidence-word cleanup.
    // The technical-architecture document is exempt — its wording is verbatim
    // by rule; its only transform is presentational (tranche tokens → chips).
    if (sourceRel === ARCH_SOURCE) {
      token.children = (token.children ?? []).flatMap(child =>
        child.type === "text" ? transformChipText(child) : [child],
      );
    } else if (tokens[i - 1]?.type !== "heading_open") {
      token.children = (token.children ?? []).flatMap(child =>
        child.type === "text" ? transformEvidenceText(child) : [child],
      );
    }
  }

  let body = md.renderer.render(tokens, md.options, env);
  const meta = PAGE_META.get(sourceRel);
  if (meta) {
    title = meta.title ?? title;
    // Build-supplied metadata line directly under the document's own H1.
    body = body.replace("</h1>", `</h1>\n<p class="page-meta">${meta.line}</p>`);
    // Hover anchors on every section heading; hrefs reuse the stable slug ids.
    body = body.replace(
      /<(h[23]) id="([^"]*)">(.*?)<\/\1>/g,
      (whole, tag, id, inner) =>
        `<${tag} id="${id}">${inner}<a class="hanchor" href="#${id}" aria-label="Link to this section">#</a></${tag}>`,
    );
  }
  const extraStyle = sourceRel === ARCH_SOURCE ? ARCH_STYLE : "";
  const nav = NAV.map(
    ([group, items]) =>
      `<div class="nav-group"><div class="nav-title">${group}</div>${items
        .map(
          ([itemRoute, label]) =>
            `<a href="${cleanRoute(itemRoute)}"${itemRoute === route ? ' class="active"' : ""}>${label}</a>`,
        )
        .join("")}</div>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f8fafb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151c23" media="(prefers-color-scheme: dark)">
<title>${title} — walras docs</title>
<style>
:root{--bg:#ffffff;--fg:#1c2733;--muted:#5b6b7b;--line:#e3e8ee;--accent:#0f62fe;--code-bg:#f4f6f8;--side:#f8fafb}
@media (prefers-color-scheme:dark){:root{--bg:#11161c;--fg:#dbe4ec;--muted:#8b9aa9;--line:#2a3440;--accent:#6ea8ff;--code-bg:#1a222b;--side:#151c23}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
.layout{display:flex;min-height:100vh}
.sidebar{width:230px;flex:none;border-right:1px solid var(--line);background:var(--side);padding:1.2rem .9rem;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{font-weight:700;font-size:1.05rem;color:var(--fg);text-decoration:none}
.sidebar .brand{margin-bottom:1rem;display:block}
.nav-title{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:1rem 0 .3rem}
.nav-group a{display:block;padding:.28rem .5rem;border-radius:6px;color:var(--fg);text-decoration:none;font-size:.92rem}
.nav-group a:hover{background:var(--line)}
.nav-group a.active{color:var(--accent);font-weight:600}
.topbar{display:none}
main{flex:1;min-width:0;padding:2.2rem clamp(1rem,4vw,3.2rem);max-width:56rem}
h1,h2,h3,h4{line-height:1.3;scroll-margin-top:4.2rem;overflow-wrap:break-word}
h1{font-size:1.7rem;border-bottom:1px solid var(--line);padding-bottom:.4rem}
h2{font-size:1.32rem;margin-top:2.2rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
a{color:var(--accent)}
p,li{overflow-wrap:break-word}
code{font:.86em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code-bg);padding:.1em .35em;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--code-bg);padding:.9rem 1rem;border-radius:8px;overflow-x:auto;line-height:1.5}
pre code{background:none;padding:0;overflow-wrap:normal}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1rem 0;max-width:100%}
table{border-collapse:collapse;font-size:.9rem;min-width:100%}
th,td{border:1px solid var(--line);padding:.42rem .6rem;text-align:left;vertical-align:top;overflow-wrap:anywhere;min-width:6rem}
th{background:var(--code-bg)}
a.figure{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
img{max-width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:8px}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.82rem;color:var(--muted)}
@media (max-width:820px){
  .sidebar{display:none}
  .topbar{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:var(--side);border-bottom:1px solid var(--line);padding:.55rem .9rem}
  .menu{position:relative}
  .menu>summary{list-style:none;cursor:pointer;padding:.45rem .9rem;border:1px solid var(--line);border-radius:8px;font-size:.92rem;user-select:none}
  .menu>summary::-webkit-details-marker{display:none}
  .menu[open]>summary{background:var(--line)}
  .menu-panel{position:fixed;left:0;right:0;top:3.1rem;bottom:0;overflow-y:auto;background:var(--bg);border-top:1px solid var(--line);padding:.6rem 1rem 2rem;z-index:9}
  .menu-panel .nav-group a{padding:.55rem .5rem;font-size:1rem;border-bottom:1px solid var(--line);border-radius:0}
  main{padding:1.2rem 1rem 2rem}
  h1{font-size:1.42rem}
  h2{font-size:1.18rem}
  body{font-size:15px}
  table{font-size:.84rem}
  pre{font-size:.82rem}
}
</style>${extraStyle}
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">walras</a>
  <details class="menu">
    <summary>Menu</summary>
    <div class="menu-panel">${nav}</div>
  </details>
</header>
<div class="layout">
<nav class="sidebar"><a class="brand" href="/">walras</a>${nav}</nav>
<main>
${body}
<footer>Generated from <a href="${GITHUB}/tree/${BRANCH}">${BRANCH}</a> @ <code>${COMMIT}</code> · Testnet software. Unaudited. Apache-2.0. See the <a href="/threat-model">threat model</a>.</footer>
</main>
</div>
</body>
</html>
`;
}

// Clear previous output but keep the Vercel project link — wiping .vercel made
// a bare `vercel deploy` silently create a fresh project instead of walras-docs.
if (existsSync(OUT)) {
  for (const entry of readdirSync(OUT)) {
    if (entry === ".vercel" || entry === ".env.local") continue;
    rmSync(join(OUT, entry), { recursive: true, force: true });
  }
} else {
  mkdirSync(OUT, { recursive: true });
}

for (const [dir, sitePath] of ASSET_DIRS) {
  cpSync(join(REPO_ROOT, dir), join(OUT, sitePath.slice(1)), { recursive: true });
}
for (const [file, sitePath] of ASSET_FILES) {
  mkdirSync(dirname(join(OUT, sitePath.slice(1))), { recursive: true });
  cpSync(join(REPO_ROOT, file), join(OUT, sitePath.slice(1)));
}

let pages = 0;
for (const [sourceRel, route] of PAGES) {
  const outPath = join(OUT, route.slice(1));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderPage(sourceRel, route));
  pages += 1;
}

// Serve every page extensionless; old `.html` deep links 308-redirect onto the
// clean path, so nothing published before this change breaks.
writeFileSync(join(OUT, "vercel.json"), JSON.stringify({ cleanUrls: true }, null, 2) + "\n");

console.log(`build-site: ${pages} pages + assets → ${OUT} (commit ${COMMIT}, clean URLs)`);
