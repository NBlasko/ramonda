import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { intersectionOf, previousFrom, writeOrCheck } from "./engine-facts.mjs";

/**
 * Writes `numbers.generated.ts`: the properties where a browser DROPS a number no type refuses.
 *
 *   node scripts/css/build-number-properties.mjs          # measure and write
 *   node scripts/css/build-number-properties.mjs --check  # fail if this machine's engines disagree
 *
 * Two mistakes, each a declaration Chromium, Firefox and WebKit throw away without a word:
 *
 * - **A length with no unit** — `gap: 12`. `CSS.supports(p, "12")` is false where `"12px"` and `"0"`
 *   are true. No type can refuse it: the property map takes `string | number` for these.
 * - **A fraction where a whole number goes** — `z-index: 1.5`. True for `"1"`, false for `"1.5"`.
 *   Neither `number` nor `` `${number}` `` refuses `1.5`, so this can only be a rule.
 *
 * Each has a second, narrower list, because a number INSIDE a longer value is a different claim:
 * `box-shadow: 0 0 1px red` is accepted, its `0` a length. A property is in the `_EVERYWHERE` list
 * only where the engines refuse the bare number at a SECOND position too — `"12px 12"` and `"12
 * 12px"` false where `"12px 12px"` is true; `"1 / 2.5"` false where `"1 / 2"` is true.
 *
 * These lists REFUSE, so they are believed only where every engine agrees, and they accumulate by
 * shrinking across machines — see `intersectionOf` in `engine-facts.mjs` for why.
 */

// `scripts/`, which every path below is written from.
const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const TAG = "build-number-properties";
const check = process.argv.includes("--check");

const OUT = join(HERE, "..", "packages", "css", "src", "compiler", "numbers.generated.ts");
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { PROPERTIES, SHORTHANDS } = await import(
  join(HERE, "..", "packages", "css", "src", "compiler", "keywords.generated.ts")
);
/** A longhand only: a shorthand's slots differ, so one value alone says nothing about another slot. */
const LONGHANDS = PROPERTIES.filter((one) => SHORTHANDS[one] === undefined);

const LISTS = {
  UNIT_REQUIRED: "a bare number is dropped where a length is taken",
  UNIT_REQUIRED_EVERYWHERE: "and also at a second position of the value",
  WHOLE_NUMBER: "a fraction is dropped where a whole number is taken",
  WHOLE_NUMBER_EVERYWHERE: "and also on either side of a `/`",
  UNIT_KIND_REFUSED: "a dimension of this kind is dropped — `z-index 2x` — written as `property kind`",
};

/**
 * One unit of each kind, asked alone: `z-index: 1x` is refused where `z-index: 1` is not. Only a
 * LONGHAND that takes some number at all is asked, so a refusal is about the unit's kind and not about
 * a value that needed company — `font: 1px` is refused for want of a family, not for its `px`.
 */
const KINDS = {
  length: "1px",
  angle: "1deg",
  time: "1s",
  frequency: "1hz",
  resolution: "1dppx",
  flex: "1fr",
  percentage: "1%",
};

const perEngine = [];
for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A DOCTYPE: quirks mode is a different CSS, and it has caught this work three times.
    await tab.setContent("<!doctype html><html><head></head><body></body></html>");
    const found = await tab.evaluate(
      ({ properties, longhands, kinds }) => {
        const ok = (property, value) => CSS.supports(property, value);
        const out = {
          UNIT_REQUIRED: [],
          UNIT_REQUIRED_EVERYWHERE: [],
          WHOLE_NUMBER: [],
          WHOLE_NUMBER_EVERYWHERE: [],
          UNIT_KIND_REFUSED: [],
        };
        for (const property of longhands) {
          if (!ok(property, "inherit")) continue;
          const forms = Object.values(kinds);
          if (!ok(property, "1") && !forms.some((one) => ok(property, one))) continue;
          for (const [kind, one] of Object.entries(kinds))
            if (!ok(property, one)) out.UNIT_KIND_REFUSED.push(`${property} ${kind}`);
        }
        for (const property of properties) {
          // A property this engine does not know cannot answer about its values.
          if (!ok(property, "inherit")) continue;
          if (!ok(property, "12") && ok(property, "12px") && ok(property, "0")) {
            out.UNIT_REQUIRED.push(property);
            if (ok(property, "12px 12px") && !ok(property, "12px 12") && !ok(property, "12 12px")) {
              out.UNIT_REQUIRED_EVERYWHERE.push(property);
            }
          }
          if (ok(property, "1") && !ok(property, "1.5")) {
            out.WHOLE_NUMBER.push(property);
            if (ok(property, "1 / 2") && !ok(property, "1 / 2.5") && !ok(property, "1.5 / 2")) {
              out.WHOLE_NUMBER_EVERYWHERE.push(property);
            }
          }
        }
        return out;
      },
      { properties: PROPERTIES, longhands: LONGHANDS, kinds: KINDS },
    );
    perEngine.push([engine, found]);
  } catch (error) {
    // A browser that will not launch would change the lists, which this must not do quietly.
    console.error(`[${TAG}] ${engine} would not launch, so the lists would be wrong: ${String(error).slice(0, 90)}`);
    console.error(`[${TAG}] run \`npx playwright install ${engine}\` in apps/playground-core, then this again.`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

/** Every engine on this machine agreeing, then every machine so far — see the note above. */
const agreed = {};
for (const name of Object.keys(LISTS)) {
  const [, first] = perEngine[0];
  const here = first[name].filter((property) => perEngine.every(([, lists]) => lists[name].includes(property)));
  // A list added since the file was written has nothing to merge with yet.
  const committed = existsSync(OUT) && readFileSync(OUT, "utf8").includes(`export const ${name}:`);
  const previous = committed
    ? previousFrom(OUT, new RegExp(`${name}: readonly string\\[\\] = (\\[[\\s\\S]*?\\])\\s*;`), undefined)
    : undefined;
  agreed[name] = previous === undefined || previous.length === 0 ? here.sort() : intersectionOf(previous, here);
}

const contents =
  `// Generated by scripts/css/${TAG}.mjs from Chromium, Firefox and WebKit, MEASURED\n` +
  `// rather than read: each browser is launched and asked CSS.supports(property, value). No engine\n` +
  `// source is used. See THIRD-PARTY.md. Do not edit.\n` +
  `//\n` +
  `// A number each of these properties DROPS in every engine measured, where no type can refuse it.\n` +
  "\n" +
  Object.entries(LISTS)
    .map(
      ([name, said]) =>
        `/** Properties where ${said}. */\nexport const ${name}: readonly string[] = ${JSON.stringify(agreed[name])};\n`,
    )
    .join("\n");

const wrote = writeOrCheck(OUT, contents, TAG, check);
console.log(
  `[${TAG}] ${Object.entries(agreed)
    .map(([name, list]) => `${name} ${list.length}`)
    .join(", ")}${wrote ? " — written" : ""}`,
);
