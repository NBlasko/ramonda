/**
 * Can the splitter's CLASSIFIER come from the generated tables instead of asking an engine?
 *
 *     node prototype-classify-from-tables.mjs
 *
 * ## Why this is the question before any of it is built
 *
 * `prototype-expand.mjs` splits 89 of 94 shorthands, and it does it by asking the engine at split
 * time which longhand a token belongs to. A compiler cannot do that: there is no browser in a build.
 * So either the classification can be derived from what this package already generates, or the
 * learned mapping has to become a generated table of its own — and which of those is true decides
 * the shape of the work, not just its size.
 *
 * ## What is compared
 *
 * Every (family, token) pair the engine classifies, against what `KEYWORDS` and `PRIMITIVE` would
 * say: a token belongs to a longhand when that longhand's keyword list holds it, or when its
 * primitive matches the token's.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const pw = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { SHORTHANDS, KEYWORDS, PRIMITIVE } = await import("../src/compiler/keywords.generated.ts");

/** The same probe vocabulary `prototype-expand.mjs` learns with. */
const TOKENS = [
  "3px",
  "9px",
  "rgb(1, 2, 3)",
  "dashed",
  "dotted",
  "7",
  "1.5s",
  "ease-in",
  "aaa",
  "37%",
  "url(a.png)",
  "row",
  "wrap",
  "left",
  "top",
  "weight",
  "dot",
  "balance",
  "pre",
  "baseline",
  "middle",
  "block",
  "inline",
  "x",
  "y",
  "cap",
  "trim-both",
  "italic",
  "bold",
  "condensed",
  "small-caps",
  "auto-flow",
  "flip-block",
  "most-width",
];

/** What kind of value a token is, by its own spelling. */
const primitiveOf = (token) =>
  /^-?[\d.]+(px|em|rem|vh|vw|ch)$/.test(token)
    ? "length"
    : /^-?[\d.]+%$/.test(token)
      ? "percentage"
      : /^-?[\d.]+(s|ms)$/.test(token)
        ? "time"
        : /^-?[\d.]+$/.test(token)
          ? "number"
          : /^(rgb|hsl|color)\(|^#/.test(token)
            ? "color"
            : token.startsWith("url(")
              ? "image"
              : null;

const browser = await pw.chromium.launch();
const tab = await browser.newPage();
await tab.setContent("<!doctype html><html><body><div id=x></div></body></html>");

const names = Object.keys(SHORTHANDS).filter((one) => !one.startsWith("-"));
const engine = await tab.evaluate(
  ([names, TOKENS]) => {
    const el = document.getElementById("x");
    const expand = (name, value) => {
      el.style.cssText = "";
      el.style.setProperty(name, value);
      const out = {};
      for (let i = 0; i < el.style.length; i++) {
        const one = el.style[i];
        if (one !== name) out[one] = el.style.getPropertyValue(one);
      }
      return out;
    };
    const held = (longhand, token) => {
      el.style.cssText = "";
      el.style.setProperty(longhand, token);
      return el.style.getPropertyValue(longhand);
    };
    const out = {};
    for (const name of names) {
      const carrier = TOKENS.find((one) => Object.keys(expand(name, one)).length > 0);
      if (carrier === undefined) continue;
      const rows = {};
      for (const token of TOKENS) {
        const holders = (got) => Object.keys(got).filter((one) => got[one] === held(one, token));
        let signature = holders(expand(name, token));
        if (signature.length === 0 && carrier !== token) {
          for (const text of [`${carrier} ${token}`, `${token} ${carrier}`]) {
            const beside = holders(expand(name, text));
            if (beside.length > 0) {
              signature = beside;
              break;
            }
          }
        }
        if (signature.length > 0) rows[token] = signature;
      }
      if (Object.keys(rows).length > 0) out[name] = rows;
    }
    return out;
  },
  [names, TOKENS],
);
await browser.close();

const wordsOf = (property) =>
  new Set(
    String(KEYWORDS[property] ?? "")
      .split(" ")
      .filter(Boolean),
  );
let agree = 0;
let differ = 0;
let silent = 0;
const examples = [];

for (const [name, rows] of Object.entries(engine)) {
  const longhands = SHORTHANDS[name] ?? [];
  for (const [token, expected] of Object.entries(rows)) {
    const primitive = primitiveOf(token);
    const fromTables = longhands.filter(
      (one) => wordsOf(one).has(token) || (primitive !== null && PRIMITIVE[one] === primitive),
    );
    if (fromTables.length === 0) {
      silent++;
      if (examples.length < 8)
        examples.push(`${name}: \`${token}\` — the tables say nothing (engine: ${expected.join("|")})`);
      continue;
    }
    const same = fromTables.length === expected.length && expected.every((one) => fromTables.includes(one));
    if (same) agree++;
    else {
      differ++;
      if (examples.length < 8)
        examples.push(`${name}: \`${token}\` — tables ${fromTables.join("|")}, engine ${expected.join("|")}`);
    }
  }
}

const total = agree + differ + silent;
console.log(`\n  (family, token) pairs the engine classifies: ${total}\n`);
console.log(`   the tables agree            ${String(agree).padStart(4)}`);
console.log(`   the tables say something else ${String(differ).padStart(2)}`);
console.log(`   the tables say nothing      ${String(silent).padStart(4)}\n`);
for (const one of examples) console.log(`   ${one}`);
console.log(
  `\n  ${agree} of ${total}. The classifier cannot come from these tables, and it is not a gap to be\n` +
    `  filled: \`KEYWORDS\` holds only properties whose grammar is CLOSED, which is the right design\n` +
    `  for reporting a wrong word — \`animation-name\` takes a free identifier and can never have a\n` +
    `  list. So the learned mapping has to become a generated table of its own, written the way\n` +
    `  \`build-shorthand-leaves.mjs\` writes its one: ask the engines once, at build-the-table time.\n`,
);
