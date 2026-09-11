/**
 * Keywords a browser accepts that `mdn-data` does not list — the third time it has not been enough.
 *
 *     node scripts/build-engine-keywords.mjs
 *
 * ## Why this exists
 *
 * `properties.ts` states the line this protects: **"rejecting valid CSS is the one failure a type map
 * may not have."** A closed union is built from `mdn-data`'s grammar, and measured against Chromium
 * the shipped unions refuse **14 values it accepts**:
 *
 *     alignment-baseline: auto, hanging          dominant-baseline: text-before-edge, text-after-edge
 *     overflow-x/y/block/inline: overlay         writing-mode: tb, rl, lr
 *     word-wrap: anywhere                        flex-wrap: balance
 *     overflow-anchor: visible
 *
 * Legacy and SVG spellings, mostly — the kind a person meets in an existing stylesheet they are
 * migrating, which is exactly the reader this package must not refuse.
 *
 * This is the same fault as the vendor prefixes and the shorthand leaves, and the same answer: ASK
 * THE ENGINES. See `build-prefixed-properties.mjs` and `build-shorthand-leaves.mjs`, whose shape
 * this follows.
 *
 * ## Why a browser cannot simply be enumerated
 *
 * `CSS.supports(property, value)` TESTS a candidate; nothing lists a property's valid keywords. So
 * the candidates are every keyword that appears in any union — 200-odd distinct words — asked of
 * every union-typed property. That is a few thousand cheap questions and it is exact: a word only
 * lands in a property's union when an engine says the declaration is valid.
 *
 * The UNION of the three engines, for the same reason the other two take it: a value one engine
 * accepts is valid CSS somewhere, and refusing it would be refusing a real page.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { previousFrom, unionOfMap, writeOrCheck } from "./engine-facts.mjs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `--check` fails instead of writing, for CI.
 *
 * The engines are asked either way — that is the whole point, and it is why this cannot live in the
 * step the unit tests run in. What `--check` changes is what happens to the answer: a difference is
 * a build that stops and names the command, rather than a file quietly rewritten in somebody's
 * working tree.
 */
const check = process.argv.includes("--check");

/** Where this writes, read back first so a second run measures the grammar rather than its own work. */
const OUT = join(HERE, "..", "packages", "css", "src", "compiler", "keywords.engine.generated.ts");
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");

/** Every closed union as it SHIPS, read out of the generated map rather than re-derived. */
const map = readFileSync(join(HERE, "..", "packages", "css", "src", "properties.generated.ts"), "utf8");
const unions = [...map.matchAll(/^\s*"([\w-]+)": Keyword<([^>]+)>;/gm)].map((one) => ({
  property: one[1],
  values: [...one[2].matchAll(/"([^"]*)"/g)].map((each) => each[1]),
}));

/** The candidates: every keyword any union holds, which is where a missing one would come from. */
const corpus = [...new Set(unions.flatMap((one) => one.values))];

/**
 * **What the GRAMMAR alone allows**, which is the union minus what a previous run of this added.
 *
 * The shipped map is grammar + this table, so comparing a value against the shipped union would find
 * nothing the moment this has run once — and writing that empty table back would DROP every value on
 * the next `build-css-properties`, which would then find them again. An oscillation, and the first
 * run measured it: 20 values, then 0.
 *
 * Subtracting its own previous output is exact and needs no second copy of `keywordsOf`: the table
 * IS the delta, so the grammar is the union without it.
 */
const previous = previousFrom(
  OUT,
  /ENGINE_KEYWORDS: Readonly<Record<string, readonly string\[\]>> = (\{[\s\S]*?\n\})\s*;/,
  {},
);
for (const one of unions) {
  const added = new Set(previous[one.property] ?? []);
  one.values = one.values.filter((value) => !added.has(value));
}

/** `Keyword<K>` already allows these, so they are never "extra". */
const GLOBAL = ["inherit", "initial", "unset", "revert", "revert-layer"];

const extra = {};
const counts = [];

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A DOCTYPE: quirks mode is a different CSS, and it has caught this work three times.
    await tab.setContent("<!doctype html><html><head></head><body></body></html>");
    const found = await tab.evaluate(
      ({ unions, corpus, global }) => {
        const out = {};
        for (const { property, values } of unions) {
          // A property this engine does not know cannot answer about its values.
          if (!CSS.supports(property, "inherit")) continue;
          const allowed = new Set([...values, ...global]);
          for (const word of corpus) {
            if (allowed.has(word)) continue;
            if (CSS.supports(property, word)) (out[property] ??= []).push(word);
          }
        }
        return out;
      },
      { unions, corpus, global: GLOBAL },
    );
    let n = 0;
    for (const [property, words] of Object.entries(found)) {
      for (const word of words) {
        (extra[property] ??= new Set()).add(word);
        n++;
      }
    }
    counts.push([engine, n]);
  } catch (error) {
    // A browser that will not launch is a SHORTER list, silently — the one thing this must not write.
    console.error(`[keywords] ${engine} would not launch, so the list would be short: ${String(error).slice(0, 90)}`);
    console.error(`[keywords] run \`npx playwright install ${engine}\` in apps/playground-core, then this again.`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

/**
 * What is committed, kept — see `engine-facts.mjs`.
 *
 * `extra` is what this machine sees BEYOND the grammar and beyond what a previous run added: the
 * subtraction above makes it the delta. Adding `previous` back is what stops a platform that sees
 * less from deleting values another platform found — measured after the first CI run, where a Linux
 * runner reported none of the macOS-only names.
 */
const merged = unionOfMap(
  previous,
  Object.fromEntries(Object.entries(extra).map(([name, values]) => [name, [...values]])),
);
const names = Object.keys(merged);
const total = names.reduce((n, one) => n + merged[one].length, 0);
const wrote = writeOrCheck(
  OUT,
  `// Generated by scripts/build-engine-keywords.mjs. Do not edit.\n` +
    `//\n` +
    `// Values an engine accepts for a property whose union mdn-data closed without them — legacy and\n` +
    `// SVG spellings, mostly. Refusing one would be refusing valid CSS, which is the one failure a\n` +
    `// type map may not have.\n` +
    `//\n` +
    `// ${total} value(s) across ${names.length} properties. The per-engine counts are printed by\n` +
    `// the run, not written here: a browser answers for its PLATFORM, so those numbers differ\n` +
    `// between machines while the values do not. See \`engine-facts.mjs\`.\n` +
    `\n` +
    `/** Property -> the extra values, beside what its \`Keyword<…>\` union already holds. */\n` +
    `export const ENGINE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {\n` +
    names.map((one) => `  ${JSON.stringify(one)}: ${JSON.stringify(merged[one])},\n`).join("") +
    `};\n`,
  "build-engine-keywords",
  check,
);

for (const [engine, n] of counts) console.log(`[keywords] ${engine.padEnd(10)} ${String(n).padStart(4)}`);
console.log(`[keywords] ${wrote ? "wrote" : "up to date —"} ${total} value(s) across ${names.length} properties`);
