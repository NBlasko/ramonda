/**
 * What every shorthand RESETS, enumerated from the engines themselves.
 *
 *     node scripts/build-shorthand-leaves.mjs
 *
 * ## Why this cannot come from `mdn-data`, and it is the third time today
 *
 * `mdn-data` marks a shorthand by giving it an `initial` that is an ARRAY of the longhands it sets,
 * and that field is wrong often enough to be unusable. `build-css-properties.mjs` already patched it
 * by hand twice — four logical shorthands whose `initial` names an unrelated property or the wrong
 * side, and six it does not know are shorthands at all — each patch found by a review measuring a
 * silently lost style.
 *
 * Measured after those patches, against what the engines actually reset: **37 more longhands a
 * shorthand resets and the table did not name.** And verified end to end through the real merge and
 * sheet, against plain CSS, in Chromium:
 *
 *     background-position-x: 37%; background: red             ours 37%          plain CSS 0%
 *     border-image-source: url(zz.png); border: 1px solid …   ours url(zz.png)  plain CSS none
 *     text-decoration-thickness: 7px; text-decoration: …      ours 7px          plain CSS auto
 *     row-gap: 7px; grid-gap: 2px                             ours 7px          plain CSS 2px
 *     animation-range-start: 37%; animation: zzz 1s           ours 37%          plain CSS normal
 *
 * The pattern in the misses is `mdn-data`'s age: `animation-range-*`, `border-image-*`,
 * `text-decoration-thickness`, `background-position-x/y` — longhands added to a shorthand after its
 * `initial` field was written. A hand-patch per release is not a design; asking the engine is.
 *
 * ## Why the UNION of three engines
 *
 * If ANY engine resets a longhand, a merge that does not clear it shows the wrong style in that
 * engine. So a name is in the list when any of them resets it. Measured today: Chromium 110
 * shorthands, Firefox 95, WebKit 102, the union 120.
 *
 * ## Why `initial` is the probe
 *
 * It is the one value that mentions no longhand, so what the declaration then holds is exactly the
 * set the shorthand controls — the engine's own expansion rather than a guess from a grammar. A
 * property that holds only ITSELF is a longhand and is not written out.
 *
 * ## What it costs to be wrong
 *
 * A longhand an engine starts resetting after this was last run is one the merge will not clear, so
 * the longhand's class lands and wins — the same silent fault this replaces, one release later. That
 * is the trade for not depending on `mdn-data`'s release cycle, and `pnpm check` cannot pay it
 * because three browsers are not something a build should download.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const mdn = createRequire(join(HERE, "build-css-properties.mjs"))("mdn-data");

/** Every name to ask about — `mdn-data`'s list is fine for the QUESTION, only not for the answer. */
const names = Object.keys(mdn.css.properties).filter((one) => one !== "--*");

/** Set each name to `initial` and read back what the declaration holds. Runs inside the browser. */
const enumerate = (given) => {
  const out = {};
  for (const name of given) {
    const element = document.createElement("div");
    element.style.setProperty(name, "initial");
    const held = [];
    for (let index = 0; index < element.style.length; index++) held.push(element.style.item(index));
    // A property that holds only itself is a longhand, and a longhand resets nothing.
    if (held.length > 1 || (held.length === 1 && held[0] !== name)) out[name] = held;
  }
  return out;
};

const union = {};
const counts = [];

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A DOCTYPE, because quirks mode is a different CSS and no real page is in it.
    await tab.setContent("<!doctype html><html><body></body></html>");
    const found = await tab.evaluate(enumerate, names);
    counts.push([engine, Object.keys(found).length]);
    for (const [name, leaves] of Object.entries(found)) {
      union[name] ??= new Set();
      for (const leaf of leaves) if (leaf !== name) union[name].add(leaf);
    }
  } catch (error) {
    // A browser that will not launch is a SHORTER list, silently — the one thing this must not write.
    console.error(`[leaves] ${engine} would not launch, so the list would be short: ${String(error).slice(0, 90)}`);
    console.error(`[leaves] run \`npx playwright install ${engine}\` in apps/playground-core, then this again.`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

const sorted = Object.keys(union).sort();
const file = join(HERE, "..", "packages", "css", "src", "compiler", "leaves.generated.ts");

writeFileSync(
  file,
  `// Generated by scripts/build-shorthand-leaves.mjs. Do not edit.\n` +
    `//\n` +
    `// What each shorthand RESETS, read out of the engines rather than out of mdn-data — whose own\n` +
    `// \`initial\` field was measured missing 37 longhands after two hand-patches for the same fault.\n` +
    `//\n` +
    counts.map(([engine, total]) => `// ${engine.padEnd(10)} ${String(total).padStart(4)}\n`).join("") +
    `// ${"the union".padEnd(10)} ${String(sorted.length).padStart(4)}\n` +
    `\n` +
    `/**\n` +
    ` * Shorthand -> every longhand some engine resets when it is written.\n` +
    ` *\n` +
    ` * The LEAVES only. What one property CLEARS is every other whose leaves are a subset of its own,\n` +
    ` * which is what makes an intermediate shorthand like \`border-width\` clearable too — see\n` +
    ` * \`SHORTHANDS\` in \`keywords.generated.ts\`, which is computed from this.\n` +
    ` */\n` +
    `export const LEAVES: Readonly<Record<string, readonly string[]>> = {\n` +
    sorted.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify([...union[name]].sort())},\n`).join("") +
    `};\n`,
);

for (const [engine, total] of counts)
  console.log(`[leaves] ${engine.padEnd(10)} ${String(total).padStart(4)} shorthands`);
console.log(`[leaves] wrote ${sorted.length} to ${file.replace(`${HERE}/../`, "")}`);
