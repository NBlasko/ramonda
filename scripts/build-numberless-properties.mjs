import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { intersectionOf, previousFrom, writeOrCheck } from "./engine-facts.mjs";

/**
 * The properties that accept NO bare number, asked of the engines themselves.
 *
 * ## The fault this answers
 *
 * `display: 1` compiled in silence while `position: statik` was caught, and so was `display: flexx`
 * — every misspelled keyword is reported, and a NUMBER where only keywords go is not. Measured over
 * twenty-nine wrong declarations on closed-keyword properties: nineteen reported, ten silent, and
 * inconsistently — `position: 1` was reported and `display: 1` was not.
 *
 * ## Why this could not come from `mdn-data`
 *
 * Both have a keyword set. What separated them was `PRIMITIVE`: `position` is in it and `display` is
 * not, so only `position` got a narrowed type that refuses a number. 373 properties have a keyword
 * set and 226 are absent from `PRIMITIVE`, because the generator could not reduce their grammar —
 * `display` is `[ <display-outside> || <display-inside> ] | …`, a combination rather than a plain
 * alternation.
 *
 * **Absence is not a fact.** It means *the grammar was not resolved*, not *this takes no number*.
 * Among the same 226 are `aspect-ratio`, `line-height`, `border-image-slice` and
 * `background-position`, where a bare number is correct CSS. A rule keyed on the gap would report
 * those, and a checker that cries wolf is one people switch off.
 *
 * So the engines are asked a POSITIVE question — `CSS.supports(property, "1")` — and the answer is
 * recorded. Measured before this existed: fourteen keyword-only properties said no to every number
 * tried, and twelve where a number is correct said yes to at least one. It separates them exactly.
 *
 * ## Several numbers, not one
 *
 * `0` is a length in every property that takes one, `700` is a weight, `0.5` is a ratio and `-1` is
 * an order. A property that refuses ALL of them is one no number belongs in. Asking with `1` alone
 * would have called `font-weight` numberless, which takes `700` and not `1`.
 *
 * ## The INTERSECTION of the engines, not the union
 *
 * The other generators here take a union — a keyword any engine accepts is one somebody may write.
 * This is the opposite claim: it says a number is WRONG, so it may only be believed where every
 * engine agrees. One engine accepting `2` is enough to keep the property out of this list.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TAG = "build-numberless-properties";
const check = process.argv.includes("--check");

const OUT = join(HERE, "..", "packages", "css", "src", "compiler", "numberless.generated.ts");
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");

/**
 * Every unprefixed property CSS has, which is what the engines are asked about.
 *
 * The whole list rather than only those with a keyword set, and that is a correction: `float`,
 * `box-sizing` and `clear` are keyword-only and are NOT in `KEYWORDS` — its rows come from grammars
 * the generator could reduce, which is the same gap this file exists to work around. Asking about a
 * property that takes numbers costs one `CSS.supports` and is answered correctly.
 *
 * Read by IMPORT rather than by regex over the generated text. The first version matched
 * `^\s*"name": "…"` across the whole file and caught `VALUE_WORDS` and `PROPERTY_NAMED` too, so the
 * list came out with `accent-color` in it three times.
 */
const { PROPERTIES } = await import(join(HERE, "..", "packages", "css", "src", "compiler", "keywords.generated.ts"));
const candidates = PROPERTIES.filter((one) => !one.startsWith("-"));

/** A property that refuses every one of these takes no number at all. See the note above. */
const NUMBERS = ["0", "1", "2", "0.5", "-1", "700", "100"];

const perEngine = [];

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A DOCTYPE: quirks mode is a different CSS, and it has caught this work three times.
    await tab.setContent("<!doctype html><html><head></head><body></body></html>");
    const found = await tab.evaluate(
      ({ properties, numbers }) => {
        const out = [];
        for (const property of properties) {
          // A property this engine does not know cannot answer about its values.
          if (!CSS.supports(property, "inherit")) continue;
          if (!numbers.some((one) => CSS.supports(property, one))) out.push(property);
        }
        return out;
      },
      { properties: candidates, numbers: NUMBERS },
    );
    perEngine.push([engine, found]);
  } catch (error) {
    // A browser that will not launch would SHORTEN the list, which is the one thing this must not do.
    console.error(`[${TAG}] ${engine} would not launch, so the list would be wrong: ${String(error).slice(0, 90)}`);
    console.error(`[${TAG}] run \`npx playwright install ${engine}\` in apps/playground-core, then this again.`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

/**
 * Every engine has to agree, and a property one of them does not KNOW is dropped.
 *
 * An engine that never heard of a property answers nothing about it, and treating silence as
 * agreement would put a property in this list on the word of two engines out of three.
 */
const [, first] = perEngine[0];
const here = first.filter((property) => perEngine.every(([, list]) => list.includes(property)));

/**
 * And every MACHINE has to agree too, which is the same argument one step out.
 *
 * The three other generators here accumulate: a platform that cannot see something keeps what
 * another platform committed, because those lists widen what the checker allows. This one is read
 * the other way — it says a bare number is a mistake — so it accumulates by SHRINKING. One engine on
 * one machine accepting a number ends the claim for everybody.
 *
 * Measured after CI went red: the intersection is 241 properties on macOS and a different number on
 * a Linux runner with the same engine versions, because WebKit there is a different build. Neither
 * answer is wrong and neither machine can be believed alone.
 *
 * An empty or absent file means nothing has been claimed yet, and this run is the claim — which is
 * also how a property that becomes numberless later gets in: delete the file and run this again.
 */
const previous = previousFrom(OUT, /NUMBERLESS: readonly string\[\] = (\[[\s\S]*?\])\s*;/, undefined);
const agreed = previous === undefined || previous.length === 0 ? here.sort() : intersectionOf(previous, here);
const dropped = previous === undefined ? [] : previous.filter((one) => !agreed.includes(one));

const contents =
  `// Generated by scripts/${TAG}.mjs from Chromium, Firefox and WebKit, MEASURED\n` +
  `// rather than read: each browser is launched and asked CSS.supports(property, value). No engine\n` +
  `// source is used. See THIRD-PARTY.md. Do not edit.\n` +
  `//\n` +
  `// The properties every engine refuses every bare number for, out of ${candidates.length} with a\n` +
  `// closed keyword set. A number written into one of these is a mistake CSS itself has no word for.\n` +
  "\n" +
  "/** Properties that accept no bare number, in any engine measured. */\n" +
  `export const NUMBERLESS: readonly string[] = ${JSON.stringify(agreed.sort())};\n`;

/**
 * Said BEFORE the check, because the check exits inside itself.
 *
 * These names are the whole reason a run fails: an engine on this machine accepts a bare number for
 * a property the committed file refuses. Printed after `writeOrCheck` they would never be seen by
 * the person the message is for.
 */
if (dropped.length > 0) {
  console.error(`[${TAG}] ${dropped.length} name(s) leave the list — an engine here accepts a number for them:`);
  for (const one of dropped) console.error(`[${TAG}]   ${one}`);
}

const wrote = writeOrCheck(OUT, contents, TAG, check);
console.log(
  `[${TAG}] ${agreed.length} of ${candidates.length} keyword properties take no number` +
    `${wrote ? " — written" : ""}\n` +
    perEngine.map(([engine, list]) => `[${TAG}]   ${engine}: ${list.length}`).join("\n"),
);
