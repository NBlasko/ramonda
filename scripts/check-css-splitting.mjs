import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The CSS follows the JavaScript chunk, asserted on a real build.
 *
 * ## The claim
 *
 * A block belongs to the module it was written in, and the Vite plugin makes each module import its
 * OWN stylesheet — so a route that is already code-split gets its own CSS from a decision the bundler
 * makes anyway. Nothing in this package splits anything; the design is what makes splitting free.
 *
 * ## Why it is a gate rather than a note
 *
 * The first design had ONE stylesheet for the whole app, and it shipped no CSS at all — the entry
 * imported the shared module, Rollup loaded it before the styled file had been transformed, the sheet
 * was empty, and the build was green with an unstyled page. Going back to one sheet would look like a
 * simplification and would take this with it, silently: the app would still work, and every route
 * would carry every rule.
 *
 * So this builds `apps/playground-core`, which has a lazily-loaded module carrying a block, and asks
 * what can only be true if the split happened AND every chunk still has what it names.
 *
 * ## What it does NOT ask any more, and that correction cost a shipped page
 *
 * This used to assert that no rule appears in two stylesheets. That reads like thrift and was the
 * exact property that hid a real fault: a rule used to have one OWNER, so two lazily-loaded routes
 * writing the same block produced one chunk with the rule and one whose JavaScript named a class no
 * stylesheet in the build contained — rendered unstyled, in production, with nothing to blame. A
 * gate asserting disjointness would have rejected the fix.
 *
 * So the question is the one that matters to a page: **every class a chunk names is in a stylesheet
 * that chunk loads.** It is asked of the MANIFEST, because that is what says which stylesheet goes
 * with which chunk. Duplication is not a fault — Vite dedupes an identical asset by content, and
 * where it cannot, a rule in two routes is what makes both of them right.
 *
 * **This app cannot exhibit that fault, and the difference is worth knowing.** Its one lazy module
 * statically imports the entry chunk, so the entry's stylesheet loads with it either way — measured
 * by putting the old behaviour back, which this gate passed. The fault needs two SIBLING lazy chunks
 * that never load together, and that shape is a fixture rather than an application: it lives in
 * `viteBuild.test.ts`, which builds it and failed before the fix. What this gate watches is the real
 * app's real splitting, which is a different question and still worth asking on every run.
 */

const root = join(import.meta.dirname, "..");
const app = join(root, "apps", "playground-core");
const TAG = "[css-splitting]";

// `--manifest` rather than a change to the app's own config: the manifest is this gate's question,
// not the application's. Through `pnpm exec` rather than `pnpm run build --`, which was measured to
// swallow the flag and leave no manifest behind.
execFileSync("pnpm", ["exec", "vite", "build", "--manifest"], { cwd: app, stdio: "pipe" });

const dist = join(app, "dist");
const assets = join(dist, "assets");
const files = readdirSync(assets);
const sheets = files.filter((name) => name.endsWith(".css"));

/** Every generated class a stylesheet names. The hash is the block's, so this needs no fixture. */
const classesIn = (name) => new Set(readFileSync(join(assets, name), "utf8").match(/\.r-[0-9a-f]{16}/g) ?? []);

const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));

const faults = [];

if (sheets.length < 2) {
  faults.push(
    `${sheets.length} stylesheet(s) in the build, and there should be at least 2 — ` +
      `a lazily-loaded module carries a block, so its CSS belongs to its own chunk.`,
  );
}

/**
 * Every class a chunk NAMES is in a stylesheet that chunk LOADS.
 *
 * A chunk loads its own CSS and the CSS of everything it statically imports; a dynamic import
 * carries its own, which is the whole point of the split. So the walk follows `imports` and stops at
 * `dynamicImports`, because the question is what is on the page when only this chunk has loaded.
 */
const loadedBy = (key, seen = new Set()) => {
  if (seen.has(key)) return [];
  seen.add(key);
  const entry = manifest[key];
  if (entry === undefined) return [];
  return [...(entry.css ?? []), ...(entry.imports ?? []).flatMap((each) => loadedBy(each, seen))];
};

for (const [key, entry] of Object.entries(manifest)) {
  if (entry.file === undefined || !entry.file.endsWith(".js")) continue;

  const named = new Set(readFileSync(join(dist, entry.file), "utf8").match(/r-[0-9a-f]{16}/g) ?? []);
  if (named.size === 0) continue;

  const loaded = loadedBy(key)
    .map((each) => readFileSync(join(dist, each), "utf8"))
    .join("");

  for (const one of named) {
    if (!loaded.includes(one)) faults.push(`${key} names \`${one}\` and loads no stylesheet holding it`);
  }
}

/** And every class a sheet names is named by a chunk, or the rule is shipped to nobody. */
const scripts = files.filter((name) => name.endsWith(".js")).map((name) => readFileSync(join(assets, name), "utf8"));
for (const sheet of sheets) {
  for (const named of classesIn(sheet)) {
    const bare = named.slice(1);
    if (!scripts.some((code) => code.includes(bare))) faults.push(`${sheet} carries ${bare}, which no chunk names`);
  }
}

if (faults.length > 0) {
  console.error(`\n${TAG} ${faults.length} thing(s) wrong with how the CSS was split:\n`);
  for (const fault of faults) console.error(`  - ${fault}`);
  console.error(
    `\n  A style block belongs to the module it was written in, and each module imports its own\n` +
      `  stylesheet holding every rule it names — which is what lets a code-split route stand on its\n` +
      `  own. One sheet for the whole app would still work and would ship every rule to every route;\n` +
      `  a rule only the OTHER route's sheet holds is a page that renders unstyled.\n`,
  );
  process.exit(1);
}

const counted = sheets.map((name) => `${name} (${classesIn(name).size})`).join(", ");
console.log(`${TAG} ${sheets.length} stylesheets, and every chunk loads the rules it names — ${counted}`);
