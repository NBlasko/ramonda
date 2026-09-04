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
 * the two things that can only be true if the split happened.
 */

const root = join(import.meta.dirname, "..");
const app = join(root, "apps", "playground-core");
const TAG = "[css-splitting]";

execFileSync("pnpm", ["run", "build"], { cwd: app, stdio: "pipe" });

const assets = join(app, "dist", "assets");
const files = readdirSync(assets);
const sheets = files.filter((name) => name.endsWith(".css"));

/** Every generated class a stylesheet names. The hash is the block's, so this needs no fixture. */
const classesIn = (name) => new Set(readFileSync(join(assets, name), "utf8").match(/\.r-[0-9a-f]{16}/g) ?? []);

const faults = [];

if (sheets.length < 2) {
  faults.push(
    `${sheets.length} stylesheet(s) in the build, and there should be at least 2 — ` +
      `a lazily-loaded module carries a block, so its CSS belongs to its own chunk.`,
  );
}

/** No rule in two sheets: a class in both is a rule shipped to routes that do not use it. */
for (const [index, one] of sheets.entries()) {
  for (const other of sheets.slice(index + 1)) {
    const shared = [...classesIn(one)].filter((name) => classesIn(other).has(name));
    if (shared.length > 0) faults.push(`${one} and ${other} both carry ${shared.join(", ")}`);
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
      `  stylesheet — which is what makes a code-split route carry only its own rules. One sheet for\n` +
      `  the whole app would still work and would ship every rule to every route.\n`,
  );
  process.exit(1);
}

const counted = sheets.map((name) => `${name} (${classesIn(name).size})`).join(", ");
console.log(`${TAG} ${sheets.length} stylesheets, no rule in two of them — ${counted}`);
