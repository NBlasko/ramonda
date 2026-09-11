/**
 * The vendor-prefixed properties every engine still has, enumerated from the engines themselves.
 *
 *     node scripts/build-prefixed-properties.mjs
 *
 * ## Why a script of its own, run on demand
 *
 * `mdn-data` holds 99 of them and it is not enough: measured, it has neither `-webkit-font-smoothing`
 * — which all three engines have — nor `-moz-osx-font-smoothing`, and those are two of the most
 * written lines in real CSS. A list built from it alone would refuse them, and refusing valid CSS is
 * the one failure this package's type map may not have.
 *
 * So the engines are asked. Playwright is not a dependency of `@ramonda/css` and three browsers are
 * not something `pnpm check` should download, so this writes a checked-in list rather than running
 * inside the build. **CI asks anyway**: the `browser` job already installs one engine and is
 * deliberately off the critical path, so `--check` runs there beside the other two generators
 * — a list that is only right until somebody remembers to regenerate it is not right — the same bargain `build-css-properties.mjs` makes with `mdn-data`, one step
 * further out.
 *
 * Measured, on Chromium 143, Firefox 145 and WebKit 26.5:
 *
 *     mdn-data      99
 *     chromium      36   (27 mdn-data does not have)
 *     firefox       83   (63)
 *     webkit       177   (153)
 *     the union    262
 *
 * ## What it costs to be wrong
 *
 * A name an engine adds after this was last run is refused until somebody runs it again. That is a
 * real cost and it is the trade the user chose over the alternative, which was no strictness at all
 * — and `ramonda-css-ignore <reason>` is the escape for a rule that is wrong once, which exists for
 * exactly this shape.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { previousFrom, unionOf, writeOrCheck } from "./engine-facts.mjs";
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

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const mdn = createRequire(join(HERE, "build-css-properties.mjs"))("mdn-data");

/** `--*` is mdn-data's entry for "a custom property", which is not a name. */
const fromMdn = Object.keys(mdn.css.properties).filter((one) => one.startsWith("-") && one !== "--*");

/**
 * Every property the engine will compute or accept, in CSS spelling.
 *
 * Two sources because neither is complete on its own: `getComputedStyle` enumerates the longhands an
 * element resolves, and the declaration prototype carries the camelCase aliases, which is where an
 * engine's prefixed shorthands live.
 */
const enumerate = () => {
  const out = new Set();
  const computed = getComputedStyle(document.body);
  for (let index = 0; index < computed.length; index++) out.add(computed.item(index));
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(document.body.style))) {
    if (/^(webkit|moz|ms|o)[A-Z]/.test(key)) out.add(`-${key.replace(/[A-Z]/g, (one) => `-${one.toLowerCase()}`)}`);
  }
  return [...out].filter((one) => one.startsWith("-"));
};

const all = new Set(fromMdn);
const counts = [["mdn-data", fromMdn.length, 0]];

for (const name of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[name].launch();
    const tab = await browser.newPage();
    const found = await tab.evaluate(enumerate);
    counts.push([name, found.length, found.filter((one) => !fromMdn.includes(one)).length]);
    for (const one of found) all.add(one);
  } catch (error) {
    // A browser that is not installed is a SHORTER list, silently — which is the one thing this
    // must not write. `npx playwright install` in apps/playground-core is what fixes it.
    console.error(`[prefixed] ${name} would not launch, so the list would be short: ${String(error).slice(0, 90)}`);
    console.error(`[prefixed] run \`npx playwright install ${name}\` in apps/playground-core, then this again.`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

const file = join(HERE, "..", "packages", "css", "src", "compiler", "prefixed.generated.ts");

/**
 * What is committed, kept — see `engine-facts.mjs`. A browser answers for the PLATFORM it runs on:
 * `-apple-pay-button-style` and `-moz-osx-font-smoothing` come from macOS builds, and a Linux runner
 * reports neither. Replacing the file would drop them and the checker would start calling them typos.
 */
const names = unionOf(previousFrom(file, /PREFIXED: readonly string\[\] = (\[[\s\S]*?\])\s*;/, []), [...all]);

const wrote = writeOrCheck(
  file,
  `// Generated by scripts/build-prefixed-properties.mjs. Do not edit.\n` +
    `//\n` +
    `// Every vendor-prefixed property mdn-data lists, plus every one Chromium, Firefox and WebKit\n` +
    `// still expose. mdn-data alone is not enough — it has neither \`-webkit-font-smoothing\` nor\n` +
    `// \`-moz-osx-font-smoothing\`, and refusing those would be refusing valid CSS.\n` +
    `//\n` +
    `// ${names.length} names. The per-engine counts are printed by the run, not written here: a\n` +
    `// browser answers for its PLATFORM, so those numbers differ between a Mac and a Linux runner\n` +
    `// while the names do not — and a header that moved with the machine made this file impossible\n` +
    `// to check in CI. See \`engine-facts.mjs\`.\n` +
    `\n` +
    `/** A vendor-prefixed property some engine has. The PREFIX is checked separately — see \`PREFIXES\`. */\n` +
    `export const PREFIXED: readonly string[] = ${JSON.stringify(names)};\n`,
  "build-prefixed-properties",
  check,
);

for (const [who, total, beyond] of counts) {
  console.log(
    `[prefixed] ${who.padEnd(10)} ${String(total).padStart(4)}${beyond > 0 ? `  (${beyond} beyond mdn-data)` : ""}`,
  );
}
console.log(`[prefixed] ${wrote ? "wrote" : "up to date —"} ${names.length} names`);
