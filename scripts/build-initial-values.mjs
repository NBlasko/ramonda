/**
 * What each longhand is worth when nothing sets it, MEASURED rather than read.
 *
 *     node scripts/build-initial-values.mjs
 *     node scripts/build-initial-values.mjs --check     # fail if this machine sees something else
 *
 * ## Why this has to exist
 *
 * A shorthand resets every longhand it covers, and a split has to write that reset itself. Outside
 * a list the word `initial` says it: `border-top-color: initial` is valid and means exactly that.
 * **Inside a list it is not.** `initial` is a CSS-wide keyword, and a CSS-wide keyword cannot stand
 * as one item of a comma-separated value — measured, all three engines reject
 * `scroll-timeline-axis: initial, initial` outright.
 *
 * That is not a cosmetic fault. A rejected declaration sets nothing, so the longhand the shorthand
 * was supposed to reset keeps whatever another class left on it, and nothing anywhere says so. It
 * is the silent direction, which is the one this package spends its gates on.
 *
 * So a list needs a value that MEANS the initial and is writable as an item, and the only place to
 * learn it is the engine: a fresh element, and what it computes the longhand to.
 *
 * ## Why mdn is not asked
 *
 * Its `initial` field is prose for a reader — `auto`, `see individual properties`, `medium` — and
 * several entries are not values at all. The same field was measured missing 37 longhands for
 * `build-shorthand-leaves`, after two hand-patches for the same fault. See `mdn-data-is-not-the-oracle`.
 *
 * ## Verified in the same run, twice
 *
 * A computed value is not automatically a value you may WRITE. Each one is set back on a second
 * element and its computed value compared: a value that does not survive that round trip is not
 * written. Measured on macOS, none of the 413 failed it — the check stays because the claim it
 * makes is what the split relies on, and a claim nothing re-measures is how a table goes wrong.
 *
 * And the three engines have to AGREE. Eight do not, and they are exactly what you would expect a
 * platform to decide: `font-family` is `Times` in Chromium, `serif` in Firefox and
 * `-webkit-standard` in WebKit. A name they disagree about is not written and is recorded in
 * {@link UNSTABLE} instead, so the split refuses the family rather than writing one engine's answer
 * everywhere.
 *
 * ## Why UNSTABLE only grows
 *
 * `engine-facts.mjs` says the merge depends on what the list is READ FOR, and this one CHANGES THE
 * OUTPUT: a wrong value here is wrong CSS. So the values take the safe direction — a name is kept
 * only where nothing has ever disagreed about it.
 *
 * Without the second list that cannot converge. A platform where the engines agree would keep
 * adding a name back, the platform where they do not would keep removing it, and `--check` would be
 * red on one machine or the other for ever. `UNSTABLE` is a union and never shrinks, so one
 * disagreement anywhere settles the name for everybody.
 *
 * **What that costs is worth knowing before you edit the file by hand.** A committed value the
 * engines now contradict is read as a disagreement, so the name moves to `UNSTABLE` and never
 * returns — a typo in the generated text takes a longhand's reset out permanently, and every list
 * family that needs it starts refusing. The header says `Do not edit` and this is what it is
 * protecting. Delete the file and regenerate to start over deliberately.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { previousFrom, unionOf, writeOrCheck } from "./engine-facts.mjs";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { LEAVES } = await loadTs(join(COMPILER, "leaves.generated.ts"));

/** Every longhand some shorthand resets. A property nothing resets never needs a reset written. */
const WANTED = [...new Set(Object.values(LEAVES).flat())].filter((one) => !one.startsWith("-")).sort();

const file = join(COMPILER, "initials.generated.ts");
const heldValues = previousFrom(file, /INITIAL_VALUES: Readonly<Record<string, string>> = (\{[\s\S]*?\n\})\s*;/, {});
const heldUnstable = previousFrom(file, /UNSTABLE: readonly string\[\] = (\[[\s\S]*?\])\s*;/, []);

const ENGINES = ["chromium", "firefox", "webkit"];
const seen = {};
for (const engine of ENGINES) {
  const browser = await pw[engine].launch();
  try {
    const tab = await browser.newPage();
    await tab.setContent("<!doctype html><html><body><div id=a></div><div id=b></div></body></html>");
    seen[engine] = await tab.evaluate((names) => {
      const a = document.getElementById("a");
      const b = document.getElementById("b");
      const out = {};
      for (const name of names) {
        a.style.cssText = "";
        const initial = getComputedStyle(a).getPropertyValue(name);
        // An empty answer means this engine does not have the property, which is not a disagreement.
        if (initial === "") continue;
        b.style.cssText = "";
        b.style.setProperty(name, initial);
        // Written back, and computed to the same thing. A value that fails this is not a value.
        if (b.style.length === 0 || getComputedStyle(b).getPropertyValue(name) !== initial) continue;
        out[name] = initial;
      }
      return out;
    }, WANTED);
  } finally {
    await browser.close();
  }
}

const measured = {};
const disagreed = [];
for (const name of WANTED) {
  const answers = ENGINES.map((one) => seen[one][name]).filter((one) => one !== undefined);
  if (answers.length === 0) continue;
  if (new Set(answers).size > 1) {
    disagreed.push(name);
    continue;
  }
  measured[name] = answers[0];
}

/** A name anything has ever disagreed about, or that a committed value now contradicts. */
const unstable = new Set(
  unionOf(
    heldUnstable,
    disagreed.concat(
      Object.keys(measured).filter((one) => heldValues[one] !== undefined && heldValues[one] !== measured[one]),
    ),
  ),
);

const values = {};
for (const name of [...new Set([...Object.keys(heldValues), ...Object.keys(measured)])].sort()) {
  if (unstable.has(name)) continue;
  // A name this platform cannot see keeps what another platform measured: not a disagreement.
  values[name] = measured[name] ?? heldValues[name];
}

const rows = Object.entries(values)
  .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
  .join("\n");

const contents =
  `// Generated by scripts/build-initial-values.mjs from Chromium, Firefox and WebKit, MEASURED\n` +
  `// rather than read: each browser is launched and asked what it computes the property to on an\n` +
  `// element nothing has styled. No engine source is used. See THIRD-PARTY.md. Do not edit.\n` +
  `//\n` +
  `// ${Object.keys(values).length} longhands, and ${unstable.size} the engines disagree about.\n` +
  `\n` +
  `/**\n` +
  ` * What a longhand is worth when nothing sets it, as text a declaration may carry.\n` +
  ` *\n` +
  ` * The word \`initial\` says this already, and cannot be written as one ITEM of a comma-separated\n` +
  ` * value — all three engines reject \`scroll-timeline-axis: initial, initial\` outright, so the\n` +
  ` * longhand a shorthand meant to reset is never reset at all. That is what this is for.\n` +
  ` *\n` +
  ` * Every value here was written back onto a second element in the same run and computed to the\n` +
  ` * same thing, so it is a value that may be SPECIFIED and not only observed.\n` +
  ` */\n` +
  `export const INITIAL_VALUES: Readonly<Record<string, string>> = {\n${rows}\n};\n` +
  `\n` +
  `/**\n` +
  ` * Longhands the engines do not agree about, which is a platform's answer rather than CSS's.\n` +
  ` *\n` +
  ` * \`font-family\` is \`Times\` in Chromium, \`serif\` in Firefox and \`-webkit-standard\` in WebKit.\n` +
  ` * Writing any one of them everywhere would be writing one engine's page into every browser, so a\n` +
  ` * name here has no value and a split that needs one refuses the family instead.\n` +
  ` *\n` +
  ` * It only ever grows: one disagreement on one platform settles the name for every platform, which\n` +
  ` * is what stops two machines adding and removing it for ever.\n` +
  ` */\n` +
  `export const UNSTABLE: readonly string[] = ${JSON.stringify([...unstable].sort(), null, 2)};\n`;

const wrote = writeOrCheck(file, contents, "build-initial-values", check);
if (!check) {
  console.log(
    `[build-initial-values] ${Object.keys(values).length} longhands, ${unstable.size} unstable` +
      `${wrote ? "" : " (unchanged)"}`,
  );
}
