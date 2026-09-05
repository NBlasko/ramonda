import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Writes `@ramonda/css`'s property map from MDN's own CSS data.
 *
 *   node scripts/build-css-properties.mjs          # write it
 *   node scripts/build-css-properties.mjs --check  # fail if it is out of date (for CI)
 *
 * ## Why generated, and why from this
 *
 * The map is what makes a CSS property name checkable: every block becomes an object literal typed
 * `Partial<CssProperties>`, and an object literal is what gets excess-property checking. So a name
 * MISSING from the map is a false error on somebody's valid CSS — which is the one failure this
 * cannot have, and the reason the list is taken from data rather than written by hand.
 *
 * `mdn-data` is **CC0-1.0**: public domain, no attribution required and no condition attached.
 *
 * ## The split, and it is measured rather than chosen
 *
 * A property gets a real union only when its grammar, fully expanded, is a `|`-separated list of
 * bare keywords. Everything else is `string | number`, and its typos belong to the CSS checker,
 * where the message is one we write. The reason is in DESIGN.md and it is readability: a template
 * literal type does catch `padding: 10pxx`, and says so in a union that grows combinatorially with
 * every shorthand position.
 *
 * Measured, on 551 non-prefixed properties: **123 are a closed keyword set** and 428 are not.
 * `display` is NOT one of them, and DESIGN.md used to say it was — its grammar allows
 * `inline flow-root`, so a union of its single keywords would reject valid CSS. That is the line
 * this holds: **a union only where the grammar is genuinely closed.**
 *
 * ## The three things a union has to allow, or it reports valid CSS
 *
 * Each was a false error before it was added, and each was measured:
 *
 * | written | without | with |
 * |---|---|---|
 * | `position: inherit` | `TS2322` | fine — every property takes the CSS-wide keywords |
 * | `position: var(--p)` | `TS2322` | fine — and `var(--p, absolute)` too |
 * | `position: absolute !important` | `TS2322` | fine |
 *
 * They are folded into one named alias, `Keyword<…>`, and the name is worth more than the tidiness:
 * TypeScript prints the ALIAS in a diagnostic instead of expanding the union, so the message stays
 * one line and the *did you mean* survives.
 *
 * ## Two files, one sweep, and that is the point
 *
 * The CSS checker needs a second table — the bare words each property accepts — and it needs to know
 * which properties the TYPES already cover, so it does not report `position: statik` a second time.
 * That is the same classification asked twice, and two scripts computing it would be a place to
 * drift: the checker would report what the types report, or go quiet where they are silent, and
 * nothing would say which.
 *
 * So one sweep writes both files, and `--check` compares both.
 */

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");
const TYPES = join(root, "packages/css/src/properties.generated.ts");
const KEYWORDS = join(root, "packages/css/src/compiler/keywords.generated.ts");
const check = process.argv.includes("--check");

/** What every message from this script is prefixed with, so a build log says who spoke. */
const TAG = "[css-properties]";

const properties = require("mdn-data/css/properties.json");
const syntaxes = require("mdn-data/css/syntaxes.json");

/**
 * A property's grammar with every `<reference>` replaced by what it stands for.
 *
 * A terminal type — `<color>`, `<length>`, `<string>` — has no entry in `syntaxes.json` and is left
 * as it is, which is exactly what marks the property as not enumerable. The depth bound stops a
 * grammar that refers to itself, and `<'property'>` references are left alone for the same reason:
 * a property whose grammar is another property's is a shorthand, and no shorthand is a keyword set.
 */
function expand(syntax, depth = 0) {
  if (depth > 8) return syntax;
  return syntax.replace(/<([a-zA-Z0-9-]+)>/g, (whole, name) =>
    syntaxes[name] === undefined ? whole : `[ ${expand(syntaxes[name].syntax, depth + 1)} ]`,
  );
}

const KEYWORD = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * The keywords a property accepts, or `undefined` when it accepts anything else as well.
 *
 * Strict on purpose. `&&`, `||` and juxtaposition all mean the property takes COMBINATIONS of its
 * keywords — `overflow: hidden auto`, `display: inline flow-root` — and a union of the singles would
 * reject those. A multiplier, a function, a comma or a terminal type means the same. Any of them and
 * the property is `string | number`.
 */
function keywordsOf(syntax) {
  const expanded = expand(syntax);
  if (/<|\(|\{|\+|\*|\?|,|#|!|&&|\|\|/.test(expanded)) return undefined;

  const parts = expanded
    .replace(/[[\]]/g, " ")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 && parts.every((part) => KEYWORD.test(part)) ? [...new Set(parts)] : undefined;
}

/**
 * The types that stand for a name the AUTHOR invents, rather than one CSS defines.
 *
 * A property reachable through any of them accepts an identifier this cannot judge, so it is left
 * alone entirely — `animation-name: slidein` is not a typo, it is a keyframes name.
 *
 * Listed rather than pattern-matched on `-ident`: `<custom-property-name>` and `<counter-name>` do
 * not end in one, and a pattern would have to be read as a claim about every future type name.
 */
const FREE = new Set([
  "custom-ident",
  "dashed-ident",
  "ident",
  "custom-property-name",
  "counter-name",
  "keyframes-name",
  "timeline-name",
  "view-transition-name",
  "feature-value-name",
  "palette-identifier",
  "container-name",
  "anchor-name",
  "position-area",
  "string",
  "url",
  "attr-name",
]);

/**
 * Every bare keyword a property's grammar reaches, and whether it admits a free identifier.
 *
 * Two kinds of reference and both have to be followed. `<type>` goes to `syntaxes.json`; `<'name'>`
 * goes to another PROPERTY, which is how a shorthand is written. Missing the second was a real gap:
 * `white-space` is `normal | pre | … || <'text-wrap-mode'>`, so `nowrap` looked unknown and valid CSS
 * would have been reported.
 *
 * A type that resolves to nothing — `<length>`, `<color-function>` — is simply dropped, because it
 * can never be a bare identifier and the question here is only about those.
 */
/** The terminals that mean a number can be written here, so the maths functions can be too. */
const NUMERIC = new Set([
  "number",
  "integer",
  "length",
  "percentage",
  "length-percentage",
  "angle",
  "angle-percentage",
  "time",
  "time-percentage",
  "frequency",
  "resolution",
  "flex",
  "ratio",
]);

/** Valid wherever a number is, and named by no property's grammar. See `numeric` in {@link scan}. */
const MATHS = ["calc", "clamp", "min", "max", "round", "abs"];

function scan(name) {
  const words = new Set();
  /**
   * The FUNCTION names the grammar reaches — `translate`, `linear-gradient`, `repeat`.
   *
   * Collected for completion and ignored by the checker, which is the same split as the two value
   * tables: a function call is not a bare word, so it can never be reported as one — and it is
   * often the only useful answer. `transform` reaches exactly one keyword, `none`.
   */
  const calls = new Set();
  /**
   * Whether the grammar reaches a NUMERIC terminal, which decides the maths functions.
   *
   * `calc()`, `clamp()`, `min()` and `max()` are valid wherever a number, length, percentage, angle
   * or time is — and `mdn-data` never spells them out, because they belong to the value syntax
   * rather than to any property. Measured: `width: cl` offered nothing, because `<length-percentage>`
   * says nothing about `clamp`. Offering them for `cursor` instead would be junk of our own, so the
   * question is asked of the grammar rather than answered everywhere.
   */
  let numeric = false;
  let free = false;
  const seen = new Set();

  const walk = (syntax, depth) => {
    // A grammar deeper than this is one nothing here understands, so it is treated as free rather
    // than as closed — the safe direction is silence.
    if (depth > 12) {
      free = true;
      return;
    }

    let rest = syntax;

    rest = rest.replace(/<'([a-zA-Z0-9-]+)'>/g, (_whole, referenced) => {
      const target = properties[referenced];
      if (target === undefined) free = true;
      else if (!seen.has(`p:${referenced}`)) {
        seen.add(`p:${referenced}`);
        walk(target.syntax, depth + 1);
      }
      return " ";
    });

    rest = rest.replace(/<([a-zA-Z0-9-]+)(?:\s*\[[^\]]*\])?>/g, (_whole, referenced) => {
      if (NUMERIC.has(referenced)) numeric = true;
      if (FREE.has(referenced)) free = true;
      else if (syntaxes[referenced] !== undefined && !seen.has(`s:${referenced}`)) {
        seen.add(`s:${referenced}`);
        walk(syntaxes[referenced].syntax, depth + 1);
      }
      return " ";
    });

    // A bare word, and never a function name — `rgb(` is a function, `red` is a keyword.
    for (const match of rest.matchAll(/(?<![\w-])([a-z][a-z0-9-]*)(?![\w-]*\()/g)) words.add(match[1]);
    // The function names on their own, for the completion table only — see `calls` above.
    for (const match of rest.matchAll(/(?<![\w-])([a-z][a-zA-Z0-9-]*)\s*\(/g)) calls.add(match[1]);
  };

  walk(properties[name].syntax, 0);
  if (numeric) for (const one of MATHS) calls.add(one);
  return { words: [...words].sort(), calls: [...calls].sort(), free };
}

/**
 * Vendor-prefixed names are left out and caught by an index signature instead.
 *
 * A hundred of them, each one a name nobody misspells into a different property — and an index
 * signature on `` `-${string}` `` accepts every one, including the prefixes MDN does not list. It
 * costs nothing that matters: a key not starting with `-` still has to be a real property, so
 * `dsiplay` is still an excess property with a suggestion beside it.
 */
/**
 * What a person wants when they hover a property, out of the same data the types come from.
 *
 * TypeScript shows a property's JSDoc in quick info by itself, so this costs the plugin nothing: the
 * type map carries it, and every editor that reads a `.d.ts` gets it. Four facts and a link, because
 * mdn-data carries no prose and inventing some would be worse than pointing at the page that has it.
 *
 * The grammar is the useful line — `row | row-reverse | column | column-reverse` says more in one
 * line than a paragraph would, and for a property with an OPEN grammar it is the only thing that
 * says what is allowed at all, since the type there is `string | number`.
 */
function documentation(name) {
  const property = properties[name];
  const initial = Array.isArray(property.initial) ? property.initial.join(", ") : property.initial;

  const lines = [`\`${name}\` — \`${String(property.syntax).replace(/\*\//g, "*\\/")}\``];
  if (initial !== undefined) lines.push(`Initial: \`${initial}\`. Inherited: ${property.inherited ? "yes" : "no"}.`);
  if (property.status !== "standard") lines.push(`Status: ${property.status}.`);
  if (property.mdn_url !== undefined) lines.push(`@see ${property.mdn_url}`);

  return [`  /**`, ...lines.map((line) => `   * ${line}`), `   */`].join("\n");
}

/**
 * The properties whose free identifier is really a PROPERTY NAME.
 *
 * A list rather than something derived, and `mdn-data` is the reason: `transition-property` is
 * `none | <single-transition-property>#`, and `<single-transition-property>` is `all | <custom-ident>`
 * — a free identifier, with nothing in the machine-readable grammar marking it as a property name.
 * The prose in the specification says it; the JSON does not.
 *
 * The `transition` SHORTHAND is deliberately absent: its value mixes a property, two times and an
 * easing function in one list, and telling which word is which needs a model of the grammar rather
 * than a set of names.
 */
const NAMES_A_PROPERTY = new Set(["transition-property", "will-change"]);

/**
 * A SHORTHAND whose words can be checked by elimination, and the longhands whose keywords they are.
 *
 * `transition`'s value mixes a property, two times and an easing function in one comma-separated
 * list, and nothing here parses that. It does not have to: every bare word in it is one of four
 * things, and three of them are sets already generated above. A time is not a bare word and
 * `cubic-bezier( … )` is a function, so both are stepped over — what is left is a property name.
 *
 * `animation` is deliberately absent, and the reason is the same one that keeps a free identifier
 * out everywhere else: `animation-name` is the author's own `@keyframes`, so there is nothing to
 * check it against.
 */
const ELIMINATION = { transition: ["transition-property", "transition-timing-function", "transition-behavior"] };

/**
 * The units `mdn-data` does not list, with what each one is.
 *
 * **Measured: its `units.json` holds thirty and is incomplete.** Missing are `%`, which it models as
 * a token type rather than a unit, the line-height units, every container-query unit, and every
 * viewport variant. A rule built from the thirty alone would report `height: 100dvh` and
 * `padding: 1cqw` — correct CSS, and the one failure a checker does not survive.
 *
 * Written down rather than inferred, because there is nothing to infer it from. Each line is one
 * family from CSS Values and Units 4 or Containment 3.
 */
/**
 * The at-rules that are NOT part of an element's rule, so a style block may not hold one.
 *
 * A deny-list rather than an allow-list, and the reason is which mistake is cheaper. The at-rules
 * that DO nest are a growing set — `@scope` and `@starting-style` are recent — and an allow-list
 * would have reported both as faults when they arrived. This way a new top-level at-rule is missed
 * in silence, which a checker survives; laying on correct CSS is what it does not.
 *
 * Every name here is asserted against `mdn-data`'s own list below, so a typo cannot sit in it.
 */
const NOT_IN_A_RULE = [
  "@charset",
  "@counter-style",
  "@document",
  "@font-face",
  "@font-feature-values",
  "@font-palette-values",
  "@import",
  "@keyframes",
  "@namespace",
  "@page",
  "@position-try",
  "@property",
  "@view-transition",
];

const MORE_UNITS = [
  "%",
  // Line height: CSS Values 4.
  "lh",
  "rlh",
  // Container query: CSS Containment 3.
  "cqw",
  "cqh",
  "cqi",
  "cqb",
  "cqmin",
  "cqmax",
  // Viewport variants, small / large / dynamic, plus the logical pair: CSS Values 4.
  "vi",
  "vb",
  "svw",
  "svh",
  "svi",
  "svb",
  "svmin",
  "svmax",
  "lvw",
  "lvh",
  "lvi",
  "lvb",
  "lvmin",
  "lvmax",
  "dvw",
  "dvh",
  "dvi",
  "dvb",
  "dvmin",
  "dvmax",
  // Root-relative font units: CSS Values 4.
  "rcap",
  "rch",
  "rex",
  "ric",
];

const named = Object.keys(properties)
  .filter((name) => !name.startsWith("-"))
  .sort();

const rows = [];
const keywordRows = [];
/**
 * Every bare word a property's grammar reaches, for COMPLETION — a different question from checking.
 *
 * `KEYWORDS` exists to report a wrong word, so it holds only properties whose grammar is CLOSED: a
 * property that also admits a free identifier can never have a word called wrong. Suggesting is not
 * reporting. `cursor` admits a `<url>` and so has no `KEYWORDS` row, and `cursor: pointer` is still
 * the answer an author wants offered — measured, they got `nav`, `noframes`, `noscript` instead,
 * because we offered nothing and the editor fell back to words from the document.
 *
 * So this holds the words for EVERY property that reaches one, free or not. One sweep, two tables,
 * and neither is the other's approximation.
 */
const valueRows = [];
/** The properties whose values TypeScript already offers, from a real union. Left to it. */
const unionTyped = [];
let unions = 0;
let checkable = 0;

for (const name of named) {
  const keywords = keywordsOf(properties[name].syntax);
  const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  const type = keywords === undefined ? "CssValue" : `Keyword<${keywords.map((k) => JSON.stringify(k)).join(" | ")}>`;
  rows.push(`${documentation(name)}\n  ${key}: ${type};`);

  if (keywords !== undefined) {
    // The types already report a bad value here, with a suggestion. The checker must not say it
    // twice — measured, `position: statik` came back from both. Completion is the same: TypeScript
    // offers a union's members itself, and offers them better — with `!important` and `var()` too.
    unions++;
    unionTyped.push(JSON.stringify(name));
    continue;
  }

  const scanned = scan(name);
  /**
   * For COMPLETION, and it differs from the row below in two ways, each measured.
   *
   * A free identifier is no reason to say nothing: the words a grammar reaches are worth offering
   * even when an unknown one cannot be called WRONG. And FUNCTIONS are included, which the checker's
   * scan drops on purpose — `transform` reaches exactly one keyword, `none`, while every useful
   * answer there is a function. Written with their parentheses, so an editor shows them as calls.
   */
  const offerable = [...scanned.words, ...scanned.calls.map((one) => `${one}()`)];
  if (offerable.length > 0) valueRows.push(`  ${JSON.stringify(name)}: ${JSON.stringify(offerable.join(" "))},`);
  /**
   * A grammar that admits a FREE identifier is the honest exclusion: a custom name, a font family,
   * an animation's own name. Nothing here can tell one of those from a typo.
   */
  if (scanned.free) continue;

  /**
   * **No keyword is not no row.** Seventy properties reach no bare word at all — `padding` and its
   * longhands, `scroll-margin` and its, the four `border-*-radius`, `opacity`, `order`, `flex-grow`,
   * `transition-duration`, `tab-size`, the SVG geometry ones — and every one of them is numeric.
   * Skipping them was measured to cost exactly what it sounds like: `padding: auto` and
   * `padding: red` both passed, because a property with no row is one the rule cannot judge.
   *
   * An empty row says the stronger and truer thing: every bare word is wrong here. The CSS-wide
   * keywords are still fine, because they are fine everywhere.
   */
  checkable++;
  keywordRows.push(`  ${JSON.stringify(name)}: ${JSON.stringify(scanned.words.join(" "))},`);
}

/** The same, for the ones whose remaining identifier is a property name — see the two sets above. */
const propertyNamedRows = [];
for (const name of named) {
  if (NAMES_A_PROPERTY.has(name)) {
    propertyNamedRows.push(`  ${JSON.stringify(name)}: ${JSON.stringify(scan(name).words.join(" "))},`);
    continue;
  }
  const longhands = ELIMINATION[name];
  if (longhands === undefined) continue;

  const words = new Set(longhands.flatMap((longhand) => scan(longhand).words));
  propertyNamedRows.push(`  ${JSON.stringify(name)}: ${JSON.stringify([...words].sort().join(" "))},`);
}

/**
 * Shorthand -> every longhand it sets, transitively.
 *
 * **Composition needs this and nothing before it did.** A shorthand and its longhand are DIFFERENT
 * properties, so merging two blocks keeps both classes and the STYLESHEET breaks the tie — measured
 * in Chromium, `.a{padding:8px}` with `.b{padding-left:40px}` gives 40px whichever order the classes
 * are written in, and 8px if the longhand is emitted first. Against the call site, silently.
 *
 * The merge answers it as CSS's own cascade does — a later shorthand clears its own longhands — and
 * this is the table it reads. **No value parsing anywhere**, which is why it is the answer: measured,
 * only 10 of the 78 shorthands split by a mechanical rule, and on this repository's own blocks 50 of
 * 108 declarations are shorthands with 7 of those splitting. Expanding VALUES would buy almost
 * nothing; clearing longhands buys all of it.
 *
 * `mdn-data` marks a shorthand by giving it an `initial` that is an ARRAY — the longhands it sets —
 * and the table is NOT that list. Two things it misses, both measured against the real table:
 *
 * - **it stops at sub-shorthands.** `border` sets `border-width`, which is itself a shorthand for
 *   four, so the list has to be closed transitively to reach the leaves.
 * - **it names no shorthand at all**, so `border` would not clear `border-left` — measured, both
 *   classes stayed on the element and a rule that `border` replaces survived it.
 *
 * So what a property CLEARS is every other property whose leaves are a SUBSET of its own, which is
 * what "sets everything that one sets" means and is computable from the same data. A longhand's
 * leaf set is itself alone, so nothing is a subset of it and it clears nothing — which is right.
 *
 * Computed once here rather than by a recursive merge on every render.
 */
function longhandsOf(name, properties, seen = new Set()) {
  const direct = properties[name]?.initial;
  if (!Array.isArray(direct)) return [];

  const out = [];
  for (const one of direct) {
    if (seen.has(one)) continue;
    seen.add(one);
    const deeper = longhandsOf(one, properties, seen);
    // A sub-shorthand is replaced by what it sets: the merge clears leaves, and a name that is
    // itself a shorthand would be a key nothing ever writes.
    if (deeper.length === 0) out.push(one);
    else out.push(...deeper);
  }
  return out;
}

/** Every property's leaves — itself, for a longhand. */
const leavesOf = new Map();
for (const name of named) {
  const leaves = longhandsOf(name, properties);
  leavesOf.set(name, new Set(leaves.length === 0 ? [name] : leaves));
}

const shorthandRows = [];
for (const name of named) {
  const mine = leavesOf.get(name);
  if (mine.size < 2) continue;

  const cleared = named
    .filter((other) => other !== name && [...leavesOf.get(other)].every((leaf) => mine.has(leaf)))
    .sort();

  if (cleared.includes(name)) {
    console.error(`\n${TAG} \`${name}\` sets itself, which would make the merge clear what it just wrote.\n`);
    process.exit(1);
  }
  shorthandRows.push(`  ${JSON.stringify(name)}: ${JSON.stringify(cleared)},`);
}

/**
 * The short spellings a readable class name is built from — `padding: 12px` becomes `r-p-12px`.
 *
 * **Written here rather than taken from any library.** None covers 551 properties, and where a
 * convention exists — `p`, `m`, `w`, `h`, `bg`, `gap`, `items`, `justify`, `rounded` — the
 * convention is the point rather than the source. A property with no entry uses its own name, which
 * is already readable: `outline-offset: 4px` becomes `r-outline-offset-4px`.
 *
 * Three things have to hold or two different declarations can produce one name, which is two rules
 * merged into one — the worst failure this package has. All three are asserted below:
 *
 * 1. **No abbreviation contains a `-`.** That is what makes the first `-` after `r-` the end of the
 *    abbreviation, so `p` with the value `l-40px` cannot be confused with `pl` and `40px`.
 * 2. **No two properties share one.**
 * 3. **No abbreviation is another property's NAME**, because a property with no entry uses its own.
 *
 * Kept small on purpose. An abbreviation nobody recognises is worse than the property's own name: it
 * is shorter and it has to be learned, which is the trade this design refuses everywhere else.
 *
 * **Two conventional spellings had to be given up, and the third assertion is what found them on the
 * first run:** `d` is a property of its own — the SVG path data — and so is `flex`. Either would have
 * made `display: flex` and `d: M0,0` one class, or `flex-direction: row` and `flex: 1`. They are
 * `disp` and `fdir` instead, which is the honest cost of a name that must never be ambiguous.
 */
const ABBREVIATIONS = {
  padding: "p",
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "padding-inline": "px",
  "padding-block": "py",
  margin: "m",
  "margin-top": "mt",
  "margin-right": "mr",
  "margin-bottom": "mb",
  "margin-left": "ml",
  "margin-inline": "mx",
  "margin-block": "my",
  width: "w",
  height: "h",
  "min-width": "minw",
  "min-height": "minh",
  "max-width": "maxw",
  "max-height": "maxh",
  display: "disp",
  position: "pos",
  overflow: "of",
  "z-index": "z",
  background: "bg",
  "background-color": "bgc",
  "background-image": "bgi",
  color: "c",
  opacity: "o",
  border: "b",
  "border-top": "bt",
  "border-right": "br",
  "border-bottom": "bb",
  "border-left": "bl",
  "border-color": "bc",
  "border-width": "bw",
  "border-style": "bs",
  "border-radius": "rounded",
  "box-shadow": "shadow",
  outline: "ol",
  "font-size": "fs",
  "font-weight": "fw",
  "font-family": "ff",
  "line-height": "lh",
  "letter-spacing": "ls",
  "text-align": "ta",
  "text-transform": "tt",
  "text-decoration": "td",
  "white-space": "ws",
  "align-items": "items",
  "align-self": "self",
  "justify-content": "justify",
  "flex-direction": "fdir",
  "flex-wrap": "wrap",
  "grid-column": "gcol",
  "grid-row": "grow",
  "grid-template-columns": "gtc",
  "grid-template-rows": "gtr",
  transition: "tr",
  transform: "tf",
  animation: "anim",
  cursor: "cur",
  "pointer-events": "pe",
  "user-select": "us",
  visibility: "vis",
};

{
  const known = new Set(named);
  const taken = new Map();
  for (const [property, short] of Object.entries(ABBREVIATIONS)) {
    const wrong = short.includes("-")
      ? `\`${short}\` holds a hyphen, which is what ends an abbreviation in a class name`
      : taken.has(short)
        ? `\`${short}\` is already ${taken.get(short)}'s`
        : !known.has(property)
          ? `\`${property}\` is not a CSS property mdn-data knows`
          : short !== property && known.has(short)
            ? `\`${short}\` is a property of its own, and a property with no abbreviation uses its name`
            : undefined;

    if (wrong !== undefined) {
      console.error(`\n${TAG} the abbreviation for \`${property}\` cannot be used: ${wrong}.\n`);
      process.exit(1);
    }
    taken.set(short, property);
  }
}

const atRules = JSON.parse(readFileSync(join(root, "node_modules/mdn-data/css/at-rules.json"), "utf8"));

/**
 * The at-rules a style block can BE, rather than hold, and the interface each one's body is typed by.
 *
 * A block written `@@font-face( … )` is not a list of properties — `src` and `font-display` are
 * DESCRIPTORS, which are a different vocabulary that happens to use the same syntax. Typing one
 * against `CssProperties` would report every line of correct CSS, so each gets its own surface, out
 * of the same data and the same sweep as the properties.
 *
 * `@keyframes` is absent because it has no descriptors: its body is ordinary rules of ordinary
 * properties, which the existing surface already types.
 */
const DESCRIBED = { "@font-face": "CssFontFaceDescriptors", "@property": "CssPropertyDescriptors" };

/**
 * A descriptor `mdn-data` marks required that is not always required, with the case that proves it.
 *
 * Required-ness is worth having — a `@font-face` with no `src` downloads nothing, and the type map
 * can say so before the page does — but it is the one claim that reports VALID CSS when it is
 * wrong, so an exception is written down rather than inferred.
 *
 * `initial-value` is required for every `syntax` except `*`, where the property is unregistered in
 * all but name and no initial value is meaningful. `mdn-data` has no field for that condition.
 *
 * Each entry is asserted below to be marked required in the data, so a descriptor that stops being
 * required — or is renamed — cannot leave a stale exemption behind.
 */
const NOT_REALLY_REQUIRED = { "@property": ["initial-value"] };

/**
 * A descriptor the data does NOT mark required, which a browser nevertheless throws the rule away
 * without — measured, not read.
 *
 * `mdn-data` gives `inherits` an initial value of `auto`, which reads as optional. In Chromium,
 * `@property --a { syntax: "<angle>"; initial-value: 45deg; }` does not appear in `cssRules` at all
 * and `--a` accepts any junk afterwards: the whole rule is dropped. The specification agrees — it is
 * required — so the type map says so, and the measurement is why this list can outvote the data.
 *
 * Each entry is asserted below to exist as a descriptor, so a rename cannot leave it dangling.
 */
const ALSO_REQUIRED = { "@property": ["inherits"] };

/** A descriptor is required when the data says it has no initial value to fall back to. */
const isRequired = (descriptor) => String(descriptor.initial).includes("required");

const descriptorInterfaces = [];
const descriptorRows = [];
for (const [atRule, interfaceName] of Object.entries(DESCRIBED)) {
  const descriptors = atRules[atRule]?.descriptors;
  if (descriptors === undefined) {
    console.error(`\n${TAG} \`${atRule}\` has no descriptors in mdn-data. Check the spelling.\n`);
    process.exit(1);
  }

  for (const name of NOT_REALLY_REQUIRED[atRule] ?? []) {
    if (descriptors[name] !== undefined && isRequired(descriptors[name])) continue;
    console.error(
      `\n${TAG} \`${name}\` is exempted from being required in \`${atRule}\`, but mdn-data no longer\n` +
        `  marks it required. Read the exemption's reason and drop it if the data caught up.\n`,
    );
    process.exit(1);
  }

  for (const name of ALSO_REQUIRED[atRule] ?? []) {
    if (descriptors[name] !== undefined) continue;
    console.error(`\n${TAG} \`${name}\` is required in \`${atRule}\`, but mdn-data has no such descriptor.\n`);
    process.exit(1);
  }

  const exempt = new Set(NOT_REALLY_REQUIRED[atRule] ?? []);
  const demanded = new Set(ALSO_REQUIRED[atRule] ?? []);
  const rows = Object.keys(descriptors)
    .sort()
    .map((name) => {
      const descriptor = descriptors[name];
      const keywords = keywordsOf(descriptor.syntax);
      const type =
        keywords === undefined ? "CssValue" : `Keyword<${keywords.map((k) => JSON.stringify(k)).join(" | ")}>`;
      const required = (isRequired(descriptor) || demanded.has(name)) && !exempt.has(name);
      const initial = Array.isArray(descriptor.initial) ? descriptor.initial.join(", ") : descriptor.initial;
      const lines = [`\`${name}\` — \`${String(descriptor.syntax).replace(/\*\//g, "*\\/")}\``];
      if (initial !== undefined) lines.push(`Initial: \`${initial}\`.`);
      const documented = [`  /**`, ...lines.map((line) => `   * ${line}`), `   */`].join("\n");
      return `${documented}\n  ${JSON.stringify(name)}${required ? "" : "?"}: ${type};`;
    });

  /**
   * The same names again, at runtime, and the reason is the one measured for properties: a QUOTED
   * key gets no *did you mean* from TypeScript. Every dashed descriptor is quoted, so `font-familly`
   * comes back as `TS2353` with nothing to act on unless the checker can suggest.
   */
  descriptorRows.push(`  ${JSON.stringify(atRule.slice(1))}: ${JSON.stringify(Object.keys(descriptors).sort())},`);

  descriptorInterfaces.push(
    `/**\n` +
      ` * What \`${atRule}\` takes — its own vocabulary, not the properties.\n` +
      ` *\n` +
      ` * A descriptor with no initial value is REQUIRED, and is written without \`?\` so leaving it out\n` +
      ` * is a type error rather than a rule of ours: a \`@font-face\` with no \`src\` loads nothing.\n` +
      ` */\n` +
      `export interface ${interfaceName} {\n${rows.join("\n")}\n}`,
  );
}
const unknownAtRule = NOT_IN_A_RULE.find((name) => atRules[name] === undefined);
if (unknownAtRule !== undefined) {
  console.error(`\n${TAG} \`${unknownAtRule}\` is not an at-rule mdn-data knows. Check the spelling.\n`);
  process.exit(1);
}

const unitsData = JSON.parse(readFileSync(join(root, "node_modules/mdn-data/css/units.json"), "utf8"));
const allUnits = [...new Set([...Object.keys(unitsData), ...MORE_UNITS].map((unit) => unit.toLowerCase()))].sort();

const types = `// Generated by scripts/build-css-properties.mjs from mdn-data (CC0-1.0). Do not edit.
//
// ${named.length} properties, ${unions} of them a closed keyword set. Everything else is \`string | number\`
// and its typos belong to the CSS checker — see the script for the measurement behind that split.

/** Every property accepts these, whatever else it accepts. */
export type CssGlobal = "inherit" | "initial" | "unset" | "revert" | "revert-layer";

/** A property that takes anything a grammar would have to read. */
export type CssValue = string | number;

/**
 * A closed set of keywords, plus the three things every property also accepts.
 *
 * Named rather than written out at each property, and the name is what keeps a diagnostic readable:
 * TypeScript prints \`Keyword<"static" | …>\` instead of expanding the whole union, and the
 * *did you mean* survives.
 */
export type Keyword<K extends string> = K | CssGlobal | \`var(\${string})\` | \`\${K | CssGlobal} !important\`;

export interface CssProperties {
${rows.join("\n")}
}

${descriptorInterfaces.join("\n\n")}
`;

const keywords = `// Generated by scripts/build-css-properties.mjs from mdn-data (CC0-1.0). Do not edit.
//
// ${checkable} properties whose values the CSS checker can judge: their grammar admits no arbitrary
// identifier, and the TYPES do not already cover them with a union. The other ${named.length - checkable} are
// absent on purpose — ${unions} are the types' to report, and the rest accept a name the author
// invents, like a keyframes name or a font family.

/**
 * Every property CSS defines, for the near-miss search.
 *
 * A runtime list, because a type has none — and one list out of one sweep is what stops the checker
 * and the type map disagreeing about what exists.
 *
 * **Not the keys of \`KEYWORDS\`, and the difference is the point.** That map holds only the ${checkable}
 * properties whose VALUES this can judge; this list is all ${named.length} names, because the near-miss
 * search is about the NAME. \`flex-direction\` is absent from the map — its values are the types' to
 * report — and it has to be here, or \`flex-dirction\` could never be suggested, which is the rule's
 * headline case.
 */
export const PROPERTIES: readonly string[] = ${JSON.stringify(named)};

/** Property -> the bare keywords its grammar reaches, space separated. */
export const KEYWORDS: Readonly<Record<string, string>> = {
${keywordRows.join("\n")}
};

/**
 * The properties whose remaining identifier is a PROPERTY NAME, and the keywords they also take.
 *
 * A list rather than something derived, and \`mdn-data\` is the reason: \`transition-property\` is
 * \`none | <single-transition-property>#\`, and \`<single-transition-property>\` is
 * \`all | <custom-ident>\` — a free identifier, with nothing in the machine-readable grammar marking
 * it as a property name. The prose in the specification says it; the JSON does not.
 *
 * The \`transition\` SHORTHAND is deliberately absent: its value mixes a property, two times and an
 * easing function in one list, and telling which word is which needs a model of the grammar rather
 * than a set of names.
 */
export const PROPERTY_NAMED: Readonly<Record<string, string>> = {
${propertyNamedRows.join("\n")}
};

/**
 * Every unit CSS has, lower-cased — \`mdn-data\`'s own, plus the families it does not list.
 *
 * The supplement is not a nicety: measured, \`units.json\` holds thirty and is missing \`%\`, the
 * line-height units, every container-query unit and every viewport variant. A rule built from the
 * thirty alone would report \`height: 100dvh\` as a fault.
 */
export const UNITS: readonly string[] = ${JSON.stringify(allUnits)};

/**
 * The at-rules that are not part of an element's rule, so a style block may not hold one.
 *
 * A deny-list rather than an allow-list: the at-rules that DO nest are a growing set — \`@scope\` and
 * \`@starting-style\` are recent — and an allow-list would have reported both when they arrived.
 */
export const NOT_IN_A_RULE: readonly string[] = ${JSON.stringify(NOT_IN_A_RULE)};

/**
 * At-rule -> the descriptors it takes, for the near-miss search inside a named block.
 *
 * The TYPES own whether a descriptor exists — each at-rule has its own interface — but they cannot
 * SUGGEST for a dashed name, because a dashed key is a quoted key and a quoted key gets no
 * *did you mean*. That is the same hole \`unknown-property\` fills for properties, and this is what
 * fills it here. The key is the at-rule without its \`@\`, which is how a block names itself.
 */
export const DESCRIPTORS: Readonly<Record<string, readonly string[]>> = {
${descriptorRows.join("\n")}
};

/**
 * Shorthand -> every longhand it sets, transitively, for the merge that composes two blocks.
 *
 * A shorthand and its longhand are different properties, so a merge keeps both and the STYLESHEET
 * breaks the tie — measured, and possibly against the call site. The merge does what CSS's own
 * cascade does instead: **a later shorthand clears its own longhands.** No value is parsed anywhere;
 * only 10 of these 78 split by a mechanical rule, so expanding values would buy almost nothing.
 *
 * **Not the list mdn-data writes.** That one stops at sub-shorthands and names no shorthand at all,
 * so \`border\` would clear neither \`border-left-width\` nor \`border-left\` — measured, both classes
 * survived a declaration that replaces them. This is every property whose leaves are a SUBSET of
 * this one's, which is what "sets everything that one sets" means.
 */
export const SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
${shorthandRows.join("\n")}
};

/**
 * Property -> every bare word its grammar reaches, space separated, for COMPLETION.
 *
 * **A different question from \`KEYWORDS\`, and that difference is the whole reason this exists.**
 * That table is for REPORTING a wrong word, so it holds only properties whose grammar is closed — a
 * property admitting a free identifier can never have a word called wrong. Suggesting is not
 * reporting: \`cursor\` admits a \`<url>\` and has no \`KEYWORDS\` row, and \`cursor: pointer\` is still
 * exactly what an author wants offered.
 *
 * Measured before this existed: a value position offered NOTHING, so the editor fell back to words
 * from the document and suggested \`nav\`, \`noframes\`, \`noscript\` — HTML tag names, in CSS.
 */
/**
 * Property -> its short spelling, for a readable class name: \`padding: 12px\` is \`r-p-12px\`.
 *
 * A property absent from this map uses its own NAME, which is already readable — so this is a small
 * curated list rather than a second vocabulary to learn. Three properties hold it together and are
 * asserted where it is generated: no abbreviation contains a \`-\`, no two properties share one, and
 * no abbreviation is another property's name.
 */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
${Object.entries(ABBREVIATIONS)
  .map(([property, short]) => `  ${JSON.stringify(property)}: ${JSON.stringify(short)},`)
  .join("\n")}
};

export const VALUE_WORDS: Readonly<Record<string, string>> = {
${valueRows.join("\n")}
};

/**
 * The properties whose values TypeScript already offers, from a real union.
 *
 * Left to it, and it answers better: its list carries \`!important\` and \`var(…)\` beside each word,
 * which no table here does.
 */
export const UNION_TYPED: readonly string[] = ${JSON.stringify(unionTyped.map((one) => JSON.parse(one)))};
`;

const said =
  `${named.length} properties, ${unions} typed as a union, ${checkable} value-checkable by the rules, ` +
  `${propertyNamedRows.length} whose value is a property name, ${allUnits.length} units, ` +
  `${NOT_IN_A_RULE.length} at-rules that may not sit in a block, ${shorthandRows.length} shorthands, ` +
  `${valueRows.length} with values to suggest, ${Object.keys(ABBREVIATIONS).length} abbreviated`;

if (!check) {
  writeFileSync(TYPES, types);
  writeFileSync(KEYWORDS, keywords);
  console.log(`[css-properties] wrote ${said}`);
  process.exit(0);
}

if (readFileSync(TYPES, "utf8") === types && readFileSync(KEYWORDS, "utf8") === keywords) {
  console.log(`[css-properties] up to date — ${said}`);
  process.exit(0);
}

console.error(
  `\n[css-properties] the generated files are out of date.\n\n` +
    `  They are written from mdn-data, so this means the data moved or the sweep that reads it did.\n` +
    `  Run \`node scripts/build-css-properties.mjs\` and read the diff: a property that GAINED a\n` +
    `  union is one whose grammar closed, and one that gained keywords is one the checker can now\n` +
    `  judge. Both files come from one sweep, so they cannot disagree.\n`,
);
process.exit(1);
