import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every file holding a `@( … )` style block is handled by the wrappers, and only those are.
 *
 * ## The fault it exists for
 *
 * The syntax is not TypeScript, so biome and oxlint cannot parse a file that holds one — measured,
 * both refuse at the parse step and a suppression comment cannot help, because it is read BY the
 * parser that already failed. `ramonda-css format` and `ramonda-css lint` are the way round it, and
 * the file has to be taken out of the tools' own runs for them to get that far.
 *
 * Which makes an exclusion list, and an exclusion list drifts in two directions, both silent:
 *
 * - **a file gains a block and is not excluded** — the repository's lint and format break, loudly,
 *   which is the survivable half;
 * - **a file stops holding one and stays excluded** — it is never linted or formatted again, and
 *   nothing says so. That is the half this exists for.
 *
 * ## What it checks
 *
 * The two lists agree with the tree, in both directions, and the root's own `lint` and `format:check`
 * hand those paths to the wrappers. Nothing here is written down twice: the tree is the source, and
 * both configs plus both scripts are compared against it.
 */

const root = join(import.meta.dirname, "..");
const TAG = "[css-blocks]";

/** Where a block may live at all. `dist`, `coverage` and the like are nobody's source. */
const SKIP = new Set(["node_modules", "dist", "build", "coverage", "coverage-prod", ".turbo", ".build", "out"]);
const SOURCE = /\.[cm]?[jt]sx?$/;

/**
 * Every source file that really holds a block.
 *
 * Read the way the compiler reads it — the cheap substring first, then the lexical scan — because
 * `@(` is also how a decorator is written, and this is a decorator-heavy repository. A list built
 * from the substring alone would name a hundred files that hold nothing.
 */
async function filesWithBlocks() {
  const { findBlocks, mayHoldABlock } = await import("@ramonda/css/compiler");
  const found = [];

  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!SOURCE.test(entry.name)) continue;

      const text = readFileSync(path, "utf8");
      if (mayHoldABlock(text) && findBlocks(text).length > 0) found.push(relative(root, path));
    }
  };

  for (const group of ["apps", "packages", "scripts"]) walk(join(root, group));
  return found.sort();
}

const holding = await filesWithBlocks();

/* ── what the two tools are told to leave alone ────────────────────────────────────────────── */

const biome = JSON.parse(readFileSync(join(root, "biome.json"), "utf8"));
const oxlint = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** A `!path` in biome's `includes`, which is how it spells an exclusion. */
const excludedFromBiome = new Set(
  (biome.files?.includes ?? []).filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1)),
);
const excludedFromOxlint = new Set(oxlint.ignorePatterns ?? []);

/**
 * What the repository CLAIMS holds a block: the paths its `lint` script hands to the wrapper.
 *
 * The source of truth for the other direction, and it has to be this rather than the configs — those
 * carry plenty of exclusions with nothing to do with a style block (generated files, templates,
 * fixtures), and none of them are this script's to police. Found by testing the gate itself: keyed
 * on the configs, a stale exclusion could hide simply by being dropped from the script too.
 */
const claimed = [...manifest.scripts.lint.matchAll(/[\w./-]+\.[cm]?[jt]sx?/g)].map((match) => match[0]);

const faults = [];

for (const file of holding) {
  if (!excludedFromBiome.has(file)) faults.push(`${file} holds a block and is not excluded in biome.json`);
  if (!excludedFromOxlint.has(file)) faults.push(`${file} holds a block and is not excluded in .oxlintrc.json`);
  if (!claimed.includes(file)) faults.push(`${file} is not handed to \`ramonda-css lint\` by the root's \`lint\``);
  if (!manifest.scripts["format:check"].includes(file)) {
    faults.push(`${file} is not handed to \`ramonda-css format\` by the root's \`format:check\``);
  }
}

/**
 * The other direction, and it is the one that goes quiet: a file that stopped holding a block, left
 * excluded, is never linted or formatted again and nothing says so.
 */
for (const file of claimed) {
  if (!holding.includes(file)) faults.push(`${file} is handed to the wrappers but holds no block any more`);
  if (excludedFromBiome.has(file) && !holding.includes(file)) {
    faults.push(`${file} is excluded from biome.json for a style block it no longer holds`);
  }
  if (excludedFromOxlint.has(file) && !holding.includes(file)) {
    faults.push(`${file} is excluded from .oxlintrc.json for a style block it no longer holds`);
  }
}

if (faults.length > 0) {
  console.error(`\n${TAG} ${faults.length} thing(s) out of step:\n`);
  for (const fault of faults) console.error(`  - ${fault}`);
  console.error(
    `\n  A file holding a \`@( … )\` block cannot be read by biome or oxlint, so it is excluded from\n` +
      `  their runs and handed to \`ramonda-css format\` and \`ramonda-css lint\` instead. Both configs\n` +
      `  and both root scripts have to name it — and an exclusion left behind after the block is gone\n` +
      `  means a file nothing checks again, which is why this looks both ways.\n`,
  );
  process.exit(1);
}

console.log(
  holding.length === 0
    ? `${TAG} no file holds a style block, and nothing is excluded for one`
    : `${TAG} ${holding.length} file(s) hold a style block, each excluded from both tools and handed to the wrappers`,
);
