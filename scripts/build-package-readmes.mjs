/**
 * Writes the fixed part of every published package's README, from what already knows the answer.
 *
 *   node scripts/build-package-readmes.mjs          # write them
 *   node scripts/build-package-readmes.mjs --check  # fail if any is out of date (for CI)
 *
 * ## Why generated
 *
 * Measured before any of this was written: of eleven published packages, five had no licence
 * section, three named no install command anywhere, one had no badges, two linked to no
 * documentation, and the `Status: 0.x` blockquote — equally true of all eleven — was on two. A
 * reader arriving from npm got a different page each time, and which facts they got depended on
 * which package they happened to want.
 *
 * None of that is a writing problem. Every one of those facts has exactly ONE source already:
 *
 * | fact | source |
 * | --- | --- |
 * | the install command | `name`, and whether anything in this repo depends on it at RUNTIME |
 * | the docs link | `homepage` |
 * | the badges | `name`, URL-encoded |
 * | the status blockquote | the release policy: pre-`1.0` everywhere, so it is the same sentence |
 *
 * So they are written from those sources, and `--check` fails the build when a README disagrees.
 *
 * ## What is NOT generated, on purpose
 *
 * The one-liner under the title, and everything below the region. An npm landing page is read by
 * somebody deciding whether to use the package; a docs page by somebody already using it. Forcing
 * one sentence to serve both makes both worse, so each README keeps its own voice and its own
 * headings — `router` has three sections and `check` has twenty-five, and that is correct.
 *
 * ## Why the markers are link definitions
 *
 * Same reason `apps/docs/scripts/build-rule-tables.mjs` uses them: a link reference definition is
 * consumed by the parser and renders as nothing at all. An HTML comment would work on npm and on
 * GitHub, but not in a renderer with `html: false` — and a README that is ever included in the docs
 * site would then show its own markers to the reader. One convention that works in every renderer
 * beats two that each work in one.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const START = "[readme:start]: #";
const END = "[readme:end]: #";

/** Every package that is actually published. A private one has no npm page to land on. */
function published() {
  const out = [];
  for (const file of globSync("packages/*/package.json", { cwd: repo }).sort()) {
    const json = JSON.parse(readFileSync(join(repo, file), "utf8"));
    if (json.private === true) continue;
    out.push({ dir: dirname(file), json });
  }
  return out;
}

/**
 * Which packages are a RUNTIME dependency of something, and so are installed without `-D`.
 *
 * Read from what this repo's own packages and apps declare, rather than from a list kept here. A
 * list would be the twelfth copy of a fact, and the one nobody updates: `@ramonda/devtools` moving
 * into `dependencies` somewhere should change its install line, and with a list it would not.
 *
 * "Ever a real dependency" rather than "usually": `@ramonda/lens` is one package's `dependency` and
 * another's `devDependency`, and it ships in a bundle, so `-D` would be wrong. A package that is
 * only ever a `devDependency` — `build`, `check`, `devtools`, `testing-library` — is a tool.
 */
function runtimePackages() {
  const runtime = new Set();
  for (const file of globSync("{packages,apps}/*/package.json", { cwd: repo })) {
    const json = JSON.parse(readFileSync(join(repo, file), "utf8"));
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const name of Object.keys(json[field] ?? {})) {
        if (name.startsWith("@ramonda/")) runtime.add(name);
      }
    }
  }
  return runtime;
}

/**
 * The peers a reader has to install themselves, alongside the package.
 *
 * `peerDependenciesMeta.optional` is the whole of the decision and it is already declared:
 * `@ramonda/form` names `bguard` as an optional peer, because only the `@ramonda/form/bguard`
 * entry point needs it, and `@ramonda/check` names `typescript` as a required one. Putting an
 * optional peer in the install line tells most readers to install something they will never use.
 *
 * `@ramonda/core` is dropped from every list: it is the framework, and somebody installing the
 * router into their app already has it. Naming it in nine install lines is noise, and core's own
 * README is where installing core belongs.
 */
function requiredPeers(json) {
  const optional = json.peerDependenciesMeta ?? {};
  return Object.keys(json.peerDependencies ?? {}).filter(
    (name) => name !== "@ramonda/core" && optional[name]?.optional !== true,
  );
}

/**
 * The install command.
 *
 * `create-ramonda` is not installed at all — it is run once, and `npm install create-ramonda` would
 * leave a dependency nobody wants. It is the one package whose command cannot be derived from how
 * anything depends on it, because nothing does.
 */
function installCommand(json, runtime) {
  const { name } = json;
  if (name === "create-ramonda") return "npm create ramonda@latest my-app";
  const flag = runtime.has(name) ? "" : "-D ";
  return `npm install ${flag}${[name, ...requiredPeers(json)].join(" ")}`;
}

/** `@ramonda/core` → `%40ramonda%2Fcore`, which is what shields.io needs and what gets typed wrong. */
function badges(name) {
  const slug = encodeURIComponent(name);
  return [
    `[![npm](https://img.shields.io/npm/v/${slug})](https://www.npmjs.com/package/${name})`,
    `[![license](https://img.shields.io/npm/l/${slug})](https://github.com/NBlasko/ramonda/blob/main/LICENSE)`,
  ].join("\n");
}

/**
 * The documentation line, from `homepage`.
 *
 * `homepage` is what npm already shows beside the package, so pointing it at the package's own
 * section rather than at the site root makes the npm page better on its own AND gives this one
 * source to read. Core's is the site root, correctly: its documentation is all of it.
 */
function documentation(homepage) {
  const shown = homepage.replace(/^https:\/\//, "");
  return `Documentation: **[${shown}](${homepage})**`;
}

const SITE = "https://ramonda.dev";

/**
 * The content file a homepage path resolves to, or `undefined` when nothing answers it.
 *
 * This is the half of the check that catches the fault that started all of this: a link that reads
 * correctly and goes nowhere. `@ramonda/server` was published pointing at a site that had no page
 * for it, and only counting the routes found that. A path is either `content/<path>.md` or
 * `content/<path>/index.md` — the same two the docs build resolves — and the bare site root is
 * always answerable, which is core's case: its documentation is the whole site.
 */
function docsPageFor(homepage) {
  const path = homepage.slice(SITE.length).replace(/\/$/, "");
  if (path === "") return "content/index.md";
  for (const candidate of [`content${path}.md`, `content${path}/index.md`]) {
    if (existsSync(join(repo, "apps/docs", candidate))) return candidate;
  }
  return undefined;
}

const STATUS = [
  "> **Status: `0.x`.** The API changes freely between releases while the design is",
  "> being explored; from `1.0` the interfaces hold. See the",
  "> [root README](https://github.com/NBlasko/ramonda#readme).",
].join("\n");

function region(json, runtime) {
  const { name, homepage } = json;
  return [
    START,
    "",
    badges(name),
    "",
    STATUS,
    "",
    "```sh",
    installCommand(json, runtime),
    "```",
    "",
    documentation(homepage),
    "",
    END,
  ].join("\n");
}

const runtime = runtimePackages();
let stale = [];
let missing = [];

for (const { dir, json } of published()) {
  const file = join(repo, dir, "README.md");
  if (!existsSync(file)) {
    missing.push(`${dir} — ${json.name} is published with no README; its npm page would be empty`);
    continue;
  }
  if (typeof json.homepage !== "string" || !json.homepage.startsWith(SITE)) {
    missing.push(`${dir} — no \`homepage\` on ramonda.dev, so its documentation link has no source`);
    continue;
  }
  const page = docsPageFor(json.homepage);
  if (page === undefined) {
    missing.push(`${dir} — \`homepage\` is ${json.homepage}, and no page in apps/docs/content answers that path`);
    continue;
  }

  const text = readFileSync(file, "utf8");
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from === -1 || to === -1) {
    missing.push(`${dir}/README.md — no \`${START}\` … \`${END}\` region to write into`);
    continue;
  }

  const updated = text.slice(0, from) + region(json, runtime) + text.slice(to + END.length);
  if (updated === text) continue;
  if (check) {
    stale.push(`${dir}/README.md`);
    continue;
  }
  writeFileSync(file, updated);
  console.log(`[readmes] ${dir}/README.md`);
}

if (missing.length > 0) {
  console.error("[readmes] every published package needs a README with a generated region:");
  for (const line of missing) console.error(`          ${line}`);
  process.exit(1);
}

if (stale.length > 0) {
  console.error("[readmes] out of date:");
  for (const line of stale) console.error(`          ${line}`);
  console.error("          run `node scripts/build-package-readmes.mjs` and commit the result.");
  process.exit(1);
}

if (check) console.log(`[readmes] up to date — ${published().length} published packages`);
