/**
 * How a BAG-OF-TOKENS shorthand splits into its longhands: the grammar read, the answer measured.
 *
 *     node scripts/build-token-shapes.mjs
 *     node scripts/build-token-shapes.mjs --check
 *
 * ## Why this is a second generator and not a wider first one
 *
 * `build-shorthand-shapes.mjs` learns the POSITIONAL families, where how many values were written
 * answers the split. `border: 1px solid red` is not that shape: the parts may be written in any
 * order and which longhand each feeds is decided by what the token IS. So the table here is a
 * RECOGNISER per slot — the words, primitives and functions that slot takes — read out of the
 * family's published value-definition grammar by `classify.ts`, which the shape generator has no
 * use for.
 *
 * ## Two sources, and the one that is NOT mdn-data
 *
 * The grammar comes from `mdn-data`. The list of longhands a shorthand resets does not, because
 * mdn-data's is wrong: `border-block-end.computed` names the three PHYSICAL `border-top-*`
 * properties, and `border-block-start.computed` mixes two shorthands with one logical longhand.
 * Measured, the engines all agree and disagree with mdn-data for 18 of 77 families. So the list is
 * asked of the browser: a shorthand set to `inherit` — legal for every property — expands in
 * `element.style`, and iterating the declaration names exactly the longhands it wrote.
 *
 * ## The boundary: flat grammars only
 *
 * A value is a bag of tokens only where the grammar has no comma, no slash and no repetition.
 * `background`, `animation`, `transition`, `mask`, `font` and `grid` all have one of the three and
 * are not in this table; they keep their shorthand and the cascade keeps deciding for them.
 *
 * ## Verification is INSIDE this generator, not beside it
 *
 * Every shape is split over a corpus built from its own slots' vocabularies and compared, as
 * COMPUTED values, against the shorthand on a second element — in every engine. A family whose
 * corpus it cannot reproduce is not written. A generator that can be wrong and a gate that catches
 * it later is two chances to ship a silent mis-mapping; this is one.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { previousFrom, writeOrCheck } from "./engine-facts.mjs";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const mdn = createRequire(join(HERE, "build-css-properties.mjs"))("mdn-data");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { parseValueSyntax, componentsOf } = await loadTs(join(COMPILER, "valueSyntax.ts"));
const { acceptedBy, isOpen, longhandsFor, resolving } = await loadTs(join(COMPILER, "classify.ts"));
const { splitTokens } = await loadTs(join(COMPILER, "split.ts"));
const { SHAPES } = await loadTs(join(COMPILER, "shapes.generated.ts"));

/**
 * A type the splitter tests DIRECTLY is not opened into its words. `acceptedBy` already stops on a
 * type with no grammar, so stopping is simply declining to hand one over — no option, no second
 * path. `<color>` alone is 192 words repeated in every family that takes one: 35 KB of 46.
 */
const DIRECT = new Set(["color"]);
const grammarOf = (name) =>
  DIRECT.has(name) ? "" : (mdn.css.syntaxes[name]?.syntax ?? mdn.css.properties[name]?.syntax ?? "");
const syntaxOf = resolving((property) => mdn.css.properties[property]?.syntax ?? "");

/** Flat: no comma, no slash, no repetition. Anything else is not a bag of tokens. */
const isFlat = (grammar) => !/[,/#]/.test(grammar) && !/\{\s*\d/.test(grammar);

/** One sample per primitive, all DISTINCT so a slot can be read back out of a split value. */
const SAMPLES = {
  color: ["rebeccapurple", "#abcdef", "rgb(1 2 3)"],
  length: ["7px", "calc(1px + 2%)"],
  percentage: ["30%"],
  number: ["3"],
  integer: ["2"],
  time: ["4s"],
  angle: ["45deg"],
  "hex-color": ["#abcdef"],
  url: ["url(a.png)"],
  "custom-ident": ["zzz"],
  "dashed-ident": ["--zz"],
  string: ['"zz"'],
  frequency: ["3khz"],
  resolution: ["2dppx"],
  flex: ["3fr"],
};

function samplesFor(slot) {
  const out = [];
  for (const word of slot.words) {
    if (out.length >= 2) break;
    if (!/^\d/.test(word)) out.push(word);
  }
  for (const type of slot.types) for (const one of SAMPLES[type] ?? []) if (out.length < 4) out.push(one);
  return out;
}

/** Each slot alone, then every slot at once — in the written order and two shuffles of it. */
function corpusFor(slots) {
  const per = slots.map(samplesFor);
  if (per.some((one) => one.length === 0)) return [];
  const out = per.flatMap((ones) => ones);
  const first = per.map((one) => one[0]);
  out.push(first.join(" "));
  if (first.length > 1) out.push([...first].reverse().join(" "));
  if (first.length > 2) out.push([first[1], first[0], ...first.slice(2)].join(" "));
  return out;
}

/**
 * A slot per component of the grammar. A component that claims no longhand is OPENED and looked
 * inside, which is what reaches the parts of `<single-animation>`; one that cannot be opened means
 * the family has no shape here.
 */
function slotsOf(term, longhands, depth = 0) {
  const out = [];
  for (const component of componentsOf(term)) {
    const mine = longhandsFor(component, longhands, syntaxOf);
    if (mine.length > 0) {
      const takes = acceptedBy(component, grammarOf);
      out.push({ longhands: mine, ...takes, open: isOpen(takes) });
      continue;
    }
    const inner = component.name !== undefined && depth < 3 ? grammarOf(component.name) : "";
    if (inner === "") return undefined;
    const below = slotsOf(parseValueSyntax(inner), longhands, depth + 1);
    if (below === undefined) return undefined;
    out.push(...below);
  }
  return out;
}

const positional = new Set(Object.keys(SHAPES));
const candidates = Object.entries(mdn.css.properties)
  .filter(([name, value]) => Array.isArray(value.computed) && value.syntax && !name.startsWith("-"))
  .map(([name]) => name)
  .filter((name) => !positional.has(name) && isFlat(mdn.css.properties[name].syntax));

const perEngine = {};
const counts = [];

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A DOCTYPE, because quirks mode is a different CSS and no real page is in it.
    await tab.setContent("<!doctype html><html><body><div id=x></div><div id=y></div></body></html>");

    // First the longhand lists, because the shapes are built ON them.
    // Sorted, because the engines write the SAME longhands in different orders — Chromium starts
    // `border` at colour, Firefox at width — and the intersection below compares printed shapes. The
    // order carries nothing: the list only says which longhands get `initial` when no token reached
    // them. Unsorted, five families including `border` itself were dropped as a disagreement.
    const lists = await tab.evaluate((names) => {
      const x = document.getElementById("x");
      const out = {};
      for (const name of names) {
        x.style.cssText = "";
        x.style.cssText = `${name}: inherit`;
        out[name] = [...x.style].sort();
      }
      return out;
    }, candidates);

    const shapes = {};
    const rejected = [];
    for (const name of candidates) {
      const longhands = lists[name] ?? [];
      if (longhands.length < 2) continue;
      let slots;
      try {
        slots = slotsOf(parseValueSyntax(mdn.css.properties[name].syntax), longhands);
      } catch {
        continue;
      }
      if (slots === undefined || slots.length === 0) continue;
      // Two slots claiming one longhand means the mapping is not one-to-one, and a split would have
      // to guess. It is how a three-slot reading of a two-component grammar was caught, not shipped.
      const claimed = slots.flatMap((one) => one.longhands);
      if (new Set(claimed).size !== claimed.length) {
        rejected.push(name);
        continue;
      }
      shapes[name] = { longhands, slots };
    }

    const cases = [];
    for (const [name, shape] of Object.entries(shapes))
      for (const value of corpusFor(shape.slots)) {
        const split = splitTokens(shape, value);
        if (split !== undefined) cases.push({ name, value, split });
      }

    const verdicts = await tab.evaluate(
      (cases) =>
        cases.map(({ name, value, split }) => {
          const x = document.getElementById("x");
          const y = document.getElementById("y");
          x.style.cssText = "";
          y.style.cssText = "";
          x.style.cssText = `${name}: ${value}`;
          if (x.style.cssText === "") return true; // This engine does not take the value at all.
          y.style.cssText = Object.entries(split)
            .map(([property, one]) => `${property}: ${one}`)
            .join("; ");
          const wrote = getComputedStyle(x);
          const ours = getComputedStyle(y);
          return Object.keys(split).every((property) => wrote[property] === ours[property]);
        }),
      cases,
    );

    for (const [index, ok] of verdicts.entries()) {
      if (ok) continue;
      const name = cases[index].name;
      if (shapes[name] !== undefined) {
        delete shapes[name];
        rejected.push(name);
      }
    }

    perEngine[engine] = { shapes, rejected };
    counts.push([engine, Object.keys(shapes).length, new Set(rejected).size]);
  } catch (error) {
    // A browser that will not launch is a SHORTER list, silently — the one thing this must not write.
    console.error(`[tokens] ${engine} would not launch, so the list would be short: ${String(error).slice(0, 90)}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

const engines = Object.keys(perEngine);
if (engines.length === 0) {
  console.error("[tokens] no engine ran, so nothing was measured");
  process.exit(1);
}

/**
 * The merge is the INTERSECTION, for the same reason the positional one is: a mapping that is WRONG
 * writes the author's value into the wrong longhand, silently. A family is written only where every
 * engine that has it agreed, and a disagreement means the splitter refuses and the shorthand stays
 * whole — the answer that cannot be wrong.
 */
const agreed = {};
for (const name of Object.keys(perEngine[engines[0]].shapes)) {
  const mine = perEngine[engines[0]].shapes[name];
  const printed = JSON.stringify(mine);
  if (engines.every((one) => JSON.stringify(perEngine[one].shapes[name]) === printed)) agreed[name] = mine;
}

const file = join(COMPILER, "tokenShapes.generated.ts");
const previous = previousFrom(file, /TOKEN_SHAPES: Readonly<Record<string, TokenShape>> = (\{[\s\S]*?\n\})\s*;/, {});
const rejected = new Set(engines.flatMap((one) => perEngine[one].rejected));
const merged = { ...previous, ...agreed };
for (const name of rejected) if (agreed[name] === undefined) delete merged[name];
const sorted = Object.keys(merged).sort();

const wrote = writeOrCheck(
  file,
  `// Generated by scripts/build-token-shapes.mjs. The GRAMMAR is read from mdn-data; the longhand\n` +
    `// list and every split in it are MEASURED in Chromium, Firefox and WebKit. No engine source is\n` +
    `// used. See THIRD-PARTY.md. Do not edit.\n` +
    `//\n` +
    `// The BAG-OF-TOKENS families: a flat grammar, written in any order, one token per slot. A\n` +
    `// family with a comma, a slash or a repetition in its grammar is not here and keeps its\n` +
    `// shorthand — see \`splitTokens\` in \`split.ts\`.\n` +
    `//\n` +
    `// A family is written only where every engine agreed, and only where it reproduced its own\n` +
    `// corpus: a mapping that is wrong puts the author's value in the wrong longhand, silently.\n` +
    `\n` +
    `/** One component of the grammar: what it takes, and where a token it takes goes. */\n` +
    `export interface TokenSlot {\n` +
    `  readonly longhands: readonly string[];\n` +
    `  readonly words: readonly string[];\n` +
    `  /** Primitives, as \`classify.ts\` resolves them: \`length\`, \`color\`, \`custom-ident\`. */\n` +
    `  readonly types: readonly string[];\n` +
    `  readonly functions: readonly string[];\n` +
    `  /** It takes a free identifier, so it is asked LAST. */\n` +
    `  readonly open: boolean;\n` +
    `}\n` +
    `\n` +
    `/** One family: every longhand the shorthand resets, and a slot per component. */\n` +
    `export interface TokenShape {\n` +
    `  readonly longhands: readonly string[];\n` +
    `  readonly slots: readonly TokenSlot[];\n` +
    `}\n` +
    `\n` +
    `export const TOKEN_SHAPES: Readonly<Record<string, TokenShape>> = {\n` +
    sorted.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(merged[name])},\n`).join("") +
    `};\n`,
  "build-token-shapes",
  check,
);

for (const [engine, total, dropped] of counts)
  console.log(`[tokens] ${engine.padEnd(10)} ${String(total).padStart(3)} families, ${dropped} rejected`);
console.log(
  `[tokens] ${wrote ? "wrote" : "up to date —"} ${sorted.length} families, ` +
    `${Object.keys(agreed).length} agreed this run`,
);
