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
/** The third output, and the only one with no runtime in it — see the note beside `units`. */
const DIMENSIONS = join(root, "packages/css/src/units.generated.ts");
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
 *
 * ## What is NOT free, and it was here until somebody hit it
 *
 * `<url>` and `<string>` were both in this set, and neither is a bare word: a `<url>` is `url(…)`, a
 * FUNCTION, and a `<string>` is quoted — and the checker's scanner steps over both before it reads a
 * word. So they excluded 33 properties from being checked at all while promising completions for
 * them, which is the shape a user reported as `cursor: noned` passing.
 *
 * Measured both ways before the change was believed. 77 real declarations across all 33 —
 * `content: attr(data-x)`, `cursor: url(a.cur), auto`, `grid-template-areas: "a b" "c d"`,
 * `font-feature-settings: "liga" 1`, `d: path("M0 0")`, `stroke: url(#g)` — **0 falsely reported**;
 * 15 typos across the same 33 — **0 missed**. Checkable rows went from 346 to 379.
 *
 * The question this set answers is "can a bare word here be something nobody can judge", and only a
 * production that IS a bare word can make it so.
 *
 * ## Six more went the same way, and one of them was hiding a closed grammar
 *
 * `<dashed-ident>` is decidable before anybody reads a vocabulary: it starts with `--`, and the
 * checker skips a word that starts with a dash — it has to, because `display: -webkit-box` is CSS
 * that works. So the anchor, timeline and position families are checkable now, and with them
 * `<anchor-name>` and `<palette-identifier>`, which are each written `<dashed-ident>`.
 *
 * `<attr-name>` and `<custom-property-name>` are the `url()` argument again: they appear only
 * inside `attr()` and `var()`, and the scanner steps over a call before it reads a word.
 *
 * **`<position-area>` was the sharpest one.** Its grammar is a CLOSED set of forty-one keywords,
 * and listing it here made `position-area: topp` pass while offering `none` as the only completion.
 * An entry in this set is a claim, and that claim was simply false. {@link freeIsFree} now refuses
 * it: measured, 379 checkable rows became 397, with no property losing one.
 */
const FREE = new Set([
  "custom-ident",
  "ident",
  "counter-name",
  "keyframes-name",
  "timeline-name",
  "view-transition-name",
  "feature-value-name",
  "container-name",
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

function scan(name, from) {
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
  /**
   * Whether the grammar reaches `<string>` ANYWHERE, including inside a function it admits.
   *
   * The question `string-not-allowed` asks: does this property's grammar reach a `<string>` anywhere.
   *
   * **It does NOT reach the `<url>` properties, and a review measured that.** `<url>` has no entry
   * in `syntaxes.json`, so the walk drops it silently, and a functional reference like
   * `<image-set()>` cannot be matched by the reference regex at all — which is the one path that
   * would have made `background-image` stringy, through `<image-set-option>`. So
   * `background-image`, `background`, `cursor`, `mask-image` and about twenty more are absent here.
   *
   * That is not a false report waiting to happen, and it was checked rather than assumed: every type
   * this walk drops across all 509 non-allowed properties is either parenthesised by definition or
   * not textual, so none of them can hold a TOP-LEVEL string. What protects `url("a.png")` is the
   * rule's own depth guard, and it is the ONLY thing that protects it. Anybody relaxing that guard on
   * the strength of this list reintroduces the exact report the rule was measured against.
   */
  let stringy = false;
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
      if (referenced === "string") stringy = true;
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

  walk(from ?? properties[name].syntax, 0);
  if (numeric) for (const one of MATHS) calls.add(one);
  return { words: [...words].sort(), calls: [...calls].sort(), free, stringy };
}

/**
 * Every entry in {@link FREE} has to BE free, and the set cannot say so about itself.
 *
 * `<position-area>` was listed there while its grammar is a closed set of keywords, so one property
 * was excluded from checking on a false claim and a typo in it passed. The claim is checkable: walk
 * the production's own grammar with the set minus itself, and if the walk comes back decidable then
 * the entry is wrong — nothing about it admits a word nobody can judge.
 *
 * Only the entries `syntaxes.json` defines can be asked. `<custom-ident>`, `<ident>` and
 * `<dashed-ident>` are terminals of the value spec with no grammar to walk, which is exactly why
 * they are the ones worth naming by hand.
 */
function freeIsFree() {
  const wrong = [];
  // A COPY, because the walk below needs the set without the entry it is asking about — and deleting
  // from a `Set` mid-iteration then adding it back puts it at the end, where the iterator sees it
  // again. That is an infinite loop, and it was this function's first version.
  for (const one of [...FREE]) {
    const grammar = syntaxes[one]?.syntax;
    if (grammar === undefined) continue;

    FREE.delete(one);
    if (!scan(undefined, grammar).free) wrong.push(one);
    FREE.add(one);
  }
  if (wrong.length > 0) {
    throw new Error(
      `FREE names ${wrong.length} production(s) whose grammar is decidable: ${wrong.join(", ")}. ` +
        `An entry there excludes every property that reaches it from being checked at all, so a typo ` +
        `in one passes. Remove it, or say here which bare word in it nobody can judge.`,
    );
  }
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

/**
 * Every `@media` feature name, written down — because nothing can supply them.
 *
 * `mdn-data`'s `@media` entry has no `descriptors`, and the grammar bottoms out at
 * `mf-name: <ident>`. The CSSOM is no help either: measured in Chromium 151, `@media (nonsense)`
 * and even `@media (min-width 40rem)` survive in `cssRules` with their text intact — an unknown
 * feature is `<general-enclosed>`, which is legal CSS that simply never matches.
 *
 * So this is a snapshot, and the rule that reads it reports only a NEAR MISS: a feature invented
 * after this was written is valid and must stay silent. **`apps/playground-core/browser` verifies
 * every name here against a real browser** — for a name Chromium knows, exactly one of `(f)` and
 * `not (f)` holds; for one it does not, both are false. That is the oracle the CSSOM is not.
 *
 * Range features are listed bare; the rule accepts `min-` and `max-` in front of them, which is
 * CSS's own prefixing rule and not a guess.
 */
/**
 * Every unit, by the value TYPE it makes — which nothing can supply either.
 *
 * `units.json` groups units by the SPEC that defines them, not by what they are: `deg`, `px` and `s`
 * are all "CSS Values and Units". So a rule asking "does `<angle>` accept `12px`" has nothing to read
 * and, without this, accepted a number with any unit at all.
 *
 * **The assertion below is what makes a written-down table safe here**: every unit in `UNITS` must
 * land in exactly one family, so a unit added to CSS fails this build until somebody classifies it.
 * That is the guarantee the media-feature table has to get from a browser instead.
 */
const UNIT_FAMILIES = {
  length: [
    "cap",
    "ch",
    "cm",
    "cqb",
    "cqh",
    "cqi",
    "cqmax",
    "cqmin",
    "cqw",
    "dvb",
    "dvh",
    "dvi",
    "dvmax",
    "dvmin",
    "dvw",
    "em",
    "ex",
    "ic",
    "in",
    "lh",
    "lvb",
    "lvh",
    "lvi",
    "lvmax",
    "lvmin",
    "lvw",
    "mm",
    "pc",
    "pt",
    "px",
    "q",
    "rcap",
    "rch",
    "rem",
    "rex",
    "ric",
    "rlh",
    "svb",
    "svh",
    "svi",
    "svmax",
    "svmin",
    "svw",
    "vb",
    "vh",
    "vi",
    "vmax",
    "vmin",
    "vw",
  ],
  angle: ["deg", "grad", "rad", "turn"],
  time: ["ms", "s"],
  resolution: ["dpcm", "dpi", "dppx", "x"],
  frequency: ["hz", "khz"],
  percentage: ["%"],
  flex: ["fr"],
};

/**
 * What a selector DOES, for the ones whose behaviour surprises people.
 *
 * `mdn-data` carries 144 selectors with their group and their MDN url and **no description**, so the
 * names below are checked against it and the sentences are written. Written, not generated, and the
 * assertion beneath is what keeps that safe: a sentence cannot be attached to a selector CSS does not
 * have, so this can go stale in only one direction — a missing entry, which shows the group and the
 * link and nothing else.
 *
 * Chosen for the surprise rather than for coverage. `:hover` needs no sentence about what hovering
 * is; `::after` needs one, because without `content` it does not exist at all.
 */
const SELECTOR_NOTES = {
  "::after":
    'A generated element after this one\'s content. It does not exist without `content` — even `content: ""` is enough.',
  "::before":
    'A generated element before this one\'s content. It does not exist without `content` — even `content: ""` is enough.',
  "::placeholder": "The placeholder text of an input. Only a few properties apply, and which ones differ by browser.",
  "::selection":
    "The part of this element the user has selected. Only colour, background, and a few text decorations apply.",
  "::first-line":
    "The first formatted line. Only inline properties apply, and the line is decided by layout rather than by the markup.",
  "::first-letter": "The first letter, if the first thing is text. Only a small set of properties apply.",
  "::marker": "A list item's bullet or number. Only `content`, colour, and font properties apply.",
  "::backdrop": "The layer behind an element in the top layer — a `<dialog>`, or fullscreen.",
  ":hover":
    "While the pointer is over this element. Never the only way to reach something — a keyboard has no pointer.",
  ":focus-visible":
    "Focused AND the browser thinks a focus ring should show — which is what to style rather than `:focus`.",
  ":focus-within": "This element, or anything inside it, has focus.",
  ":has()":
    "This element, if the selector inside matches something it contains. The one selector that looks downwards.",
  ":is()": "Any of the selectors inside, and it takes the specificity of the most specific one.",
  ":where()": "Any of the selectors inside, at ZERO specificity — which is what makes it safe in a library.",
  ":not()": "Anything the selectors inside do not match, at the specificity of the most specific one.",
  ":nth-child()": "Counted among ALL siblings, not among the ones that match. `:nth-of-type` is the other question.",
  ":only-child": "The only child of its parent, of any kind.",
  ":empty": "No children at all, and text counts as a child — whitespace included.",
  ":target": "The element the URL's fragment names.",
  ":disabled":
    "A form control that is disabled. Not the same as `[disabled]`, which is the attribute rather than the state.",
  ":checked": "A checkbox, radio or option that is checked. The STATE, which the attribute only starts.",
  ":root": "The document's root element — `<html>`, and the usual place for custom properties.",
};

const MEDIA_FEATURES = [
  "any-hover",
  "any-pointer",
  "aspect-ratio",
  "color",
  "color-gamut",
  "color-index",
  "device-aspect-ratio",
  "device-height",
  "device-width",
  "display-mode",
  "dynamic-range",
  "forced-colors",
  "grid",
  "height",
  "hover",
  "inverted-colors",
  "monochrome",
  "orientation",
  "overflow-block",
  "overflow-inline",
  "pointer",
  "prefers-color-scheme",
  "prefers-contrast",
  "prefers-reduced-data",
  "prefers-reduced-motion",
  "prefers-reduced-transparency",
  "resolution",
  "scripting",
  "update",
  "video-dynamic-range",
  "width",
];

/** The ones `min-` and `max-` may be written in front of — CSS's own rule, not a guess. */
const RANGE_FEATURES = [
  "aspect-ratio",
  "color",
  "color-index",
  "device-aspect-ratio",
  "device-height",
  "device-width",
  "height",
  "monochrome",
  "resolution",
  "width",
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

freeIsFree();

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

/**
 * The properties a quoted string may appear in, which is asked of EVERY property.
 *
 * Not part of the loop above, because that one leaves early twice — for a union-typed property and
 * for a free one — and this question has to be answered for those too. `display` is union-typed and
 * `display: "flex"` is exactly the fault this is for.
 *
 * A property whose grammar this cannot decide is listed as allowing one. Silence is the safe
 * direction here more than anywhere: the rule reports a value the author WROTE, on a property whose
 * grammar is the reason, so a wrong report is a person deleting quotes that belonged there.
 */
const stringAllowed = named.filter((name) => {
  const scanned = scan(name);
  return scanned.stringy || scanned.free;
});

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
const classified = new Map();
for (const [family, units] of Object.entries(UNIT_FAMILIES)) {
  for (const unit of units) {
    const already = classified.get(unit);
    if (already !== undefined) {
      console.error(`[css-properties] \`${unit}\` is in both \`${already}\` and \`${family}\`.`);
      process.exit(1);
    }
    classified.set(unit, family);
  }
}

const selectorData = JSON.parse(readFileSync(join(root, "node_modules/mdn-data/css/selectors.json"), "utf8"));

/**
 * Name -> its group and its MDN url. Generated; the sentences beside them are not.
 *
 * A functional pseudo-class is keyed `:has()` in `mdn-data` and written `:has(…)` in a block, so the
 * table holds the upstream spelling and the reader strips the parentheses to look it up. Measured by
 * getting it wrong: five of the notes below named `:has`, `:is`, `:where`, `:not` and `:nth-child`,
 * and the assertion beneath refused all five — which is exactly what it is for.
 */
const selectors = Object.fromEntries(
  Object.entries(selectorData)
    .filter(([name]) => name.startsWith(":"))
    .map(([name, one]) => [
      name,
      {
        group: (one.groups ?? []).join(", "),
        url: one.mdn_url ?? "",
        note: SELECTOR_NOTES[name] ?? "",
      },
    ]),
);

const notesForNothing = Object.keys(SELECTOR_NOTES).filter((name) => selectors[name] === undefined);
if (notesForNothing.length > 0) {
  console.error(
    `[css-properties] ${notesForNothing.length} written selector note(s) for a selector CSS does not have: ` +
      `${notesForNothing.join(", ")}.\n` +
      `  A note is prose and cannot be generated, but the NAME can be checked — and a note on a\n` +
      `  selector that does not exist would be a sentence nobody could ever read.`,
  );
  process.exit(1);
}

/**
 * Every at-rule's MDN url, and nothing written beside it.
 *
 * Unlike the selectors, this needs no prose at all: all 19 at-rules in `mdn-data` carry a url, and
 * the CONDITION a person hovers — `@media (min-width: 40rem)` — is already the specific question.
 * Its own text plus the link is the whole answer, and a sentence would be repeating the text.
 */
const atRuleLinks = Object.fromEntries(
  Object.entries(atRules)
    .filter(([, one]) => one.mdn_url)
    .map(([name, one]) => [name, one.mdn_url]),
);

const mediaFeatures = [
  ...new Set([...MEDIA_FEATURES, ...RANGE_FEATURES.flatMap((one) => [`min-${one}`, `max-${one}`])]),
].sort();

const notARange = RANGE_FEATURES.find((one) => !MEDIA_FEATURES.includes(one));
if (notARange !== undefined) {
  console.error(`[css-properties] \`${notARange}\` is listed as a range feature and is not a feature.`);
  process.exit(1);
}

const allUnits = [...new Set([...Object.keys(unitsData), ...MORE_UNITS].map((unit) => unit.toLowerCase()))].sort();

const unclassified = allUnits.filter((one) => !classified.has(one));
if (unclassified.length > 0) {
  console.error(
    `[css-properties] ${unclassified.length} unit(s) with no value type: ${unclassified.join(", ")}.\n` +
      `  Add each to UNIT_FAMILIES in this script. A rule asks what a unit IS, and an unclassified\n` +
      `  one would be accepted everywhere — which is the false report this table exists to prevent.`,
  );
  process.exit(1);
}

const invented = [...classified.keys()].filter((one) => !allUnits.includes(one));
if (invented.length > 0) {
  console.error(`[css-properties] classified unit(s) CSS does not have: ${invented.join(", ")}.`);
  process.exit(1);
}

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
 * The properties a quoted string may appear in.
 *
 * ${stringAllowed.length} of ${named.length}, and the rest is what \`string-not-allowed\` reports: a value like
 * \`color: "yellow"\` compiles, ships \`color:"yellow"\` and is dropped by every browser, because the
 * quotes are part of a CSS string and \`color\` has no place for one. Reported by a user, who was
 * offered the word by the editor and wrote the quotes themselves.
 *
 * A property is here when its grammar reaches \`<string>\` anywhere — \`content\`, \`font-family\`,
 * \`quotes\`, \`grid-template-areas\` — or when its grammar reaches something nothing here can judge.
 * The second half is not a nicety: this rule reports what the author wrote, so being wrong means
 * telling somebody to delete quotes that belonged there.
 *
 * **The \`<url>\` properties are NOT here**, which a review measured and which matters to anybody
 * touching the rule: \`mdn-data\` gives \`<url>\` no grammar and the walk cannot follow a functional
 * reference like \`<image-set()>\`, so \`background-image\` and about twenty relatives are absent. What
 * keeps \`url("a.png")\` from being reported is the rule's DEPTH GUARD, and nothing else. Checked
 * rather than assumed: none of the types this walk drops can hold a top-level string.
 */
export const STRING_ALLOWED: readonly string[] = ${JSON.stringify(stringAllowed)};

/**
 * Every unit CSS has, lower-cased — \`mdn-data\`'s own, plus the families it does not list.
 *
 * The supplement is not a nicety: measured, \`units.json\` holds thirty and is missing \`%\`, the
 * line-height units, every container-query unit and every viewport variant. A rule built from the
 * thirty alone would report \`height: 100dvh\` as a fault.
 */
export const UNITS: readonly string[] = ${JSON.stringify(allUnits)};

/**
 * Each unit's value TYPE, so a rule can ask whether \`<angle>\` accepts \`12px\`.
 *
 * \`units.json\` groups by the spec that defines a unit, not by what it is — \`deg\`, \`px\` and \`s\` are
 * all "CSS Values and Units" — so this is written down. Every unit in \`UNITS\` lands in exactly one
 * family and the generator refuses to run otherwise, which is what makes a hand-written table safe
 * here: a unit CSS adds fails the build until somebody says what it is.
 */
export const UNIT_TYPE: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries(classified))};

/**
 * Every \`@media\` feature name, including the \`min-\`/\`max-\` forms of the range ones.
 *
 * Written down rather than derived: \`@media\` has no descriptors in \`mdn-data\` and its grammar
 * bottoms out at \`mf-name: <ident>\`. Measured, the browser cannot be asked either — an unknown
 * feature is \`<general-enclosed>\`, legal CSS that never matches, so \`@media (nonsense)\` survives
 * a parse intact. The rule reading this therefore reports only a NEAR MISS, and a feature invented
 * later stays silent.
 *
 * Verified against a real browser in \`apps/playground-core/browser\`.
 */
export const MEDIA_FEATURES: readonly string[] = ${JSON.stringify(mediaFeatures)};

/**
 * Every pseudo-class and pseudo-element CSS has, with its group, its MDN url, and a note for the
 * ones whose behaviour surprises people.
 *
 * The names, groups and urls come from \`mdn-data\`. The NOTES do not — that file carries no
 * descriptions — so they are written in \`scripts/build-css-properties.mjs\`, and the generator
 * refuses to run if one names a selector CSS does not have. A selector with no note shows its group
 * and its link, which is already more than "\`(property) "&::after"\`".
 *
 * Read by the editor's hover, where a reader is already looking at the thing they are asking about.
 */
export const SELECTORS: Readonly<Record<string, { group: string; url: string; note: string }>> = ${JSON.stringify(selectors)};

/**
 * Every at-rule's MDN url, read from \`mdn-data\` — all 19 of them have one.
 *
 * No prose beside it, and that is the difference from \`SELECTORS\`: the CONDITION somebody hovers is
 * already the specific question — \`@media (min-width: 40rem)\` says what it asks — so its own text
 * and the link are the whole answer.
 */
export const AT_RULE_LINKS: Readonly<Record<string, string>> = ${JSON.stringify(atRuleLinks)};

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

/**
 * `CssDimension` and the unit unions, from the SAME table the checker's `unknown-unit` rule asks.
 *
 * ## Why this is a third file rather than a third export
 *
 * It holds no runtime value at all, and that is what lets `@ramonda/css` — the entry a page loads —
 * re-export it. That entry imports NOTHING by rule, and a `export type` from a file with data in it
 * is one careless edit away from importing the data.
 *
 * ## What it is for, and where the error lands
 *
 * A block's value is `string | number` for 442 of 551 properties and has to be: 349 of them are
 * composite — `border-left` is `<line-width> || <line-style> || <color>` — so a type narrow enough
 * to refuse `4px sollid red` would refuse `red 4px solid`, which is correct CSS.
 *
 * So the type goes where the value is MADE. `const border: CssDimension = ` + backtick +
 * `${this.weight}px` refuses `pddx` on the declaration, which is the line somebody wrote, and is
 * where `unknown-unit` already reports a unit typed straight into a block.
 *
 * **The unit set is a parameter**, which is the whole point: a design system that has settled on
 * `px` writes `CssDimension<"px">` and `rem` stops compiling.
 *
 * A family gets its own union only where it HAS more than one unit. `percentage` and `flex` hold
 * one each, and `CssDimension<"%">` says that better than a name would.
 */
const families = [...new Set(classified.values())]
  .map((family) => [family, allUnits.filter((unit) => classified.get(unit) === family)])
  .filter(([, units]) => units.length > 1);

const unitUnion = (units) => units.map((unit) => JSON.stringify(unit)).join(" | ");

const units = `// Generated by scripts/build-css-properties.mjs from mdn-data. Do not edit.
//
// Types only, and no runtime: this is what \`@ramonda/css\` re-exports, and that entry imports
// nothing. ${allUnits.length} units, ${families.length} families with more than one.

/** Every unit CSS has, from \`mdn-data\` — the same list \`unknown-unit\` measures a typo against. */
export type CssUnit = ${unitUnion(allUnits)};
${families
  .map(
    ([family, list]) => `
/** The ${list.length} \`<${family}>\` units. \`CssDimension<Css${family[0].toUpperCase()}${family.slice(1)}Unit>\` is a${"aeiou".includes(family[0]) ? "n" : ""} ${family} and nothing else. */
export type Css${family[0].toUpperCase()}${family.slice(1)}Unit = ${unitUnion(list)};`,
  )
  .join("\n")}

/**
 * A number with a unit on it, for the declaration that MAKES one rather than for the block.
 *
 * \`\`\`ts
 * const border: CssDimension = \`\${this.weight}px\`;      // fine
 * const border: CssDimension = \`\${this.weight}pddx\`;    // TS2322, on this line
 * const gap: CssDimension<"px"> = \`\${this.gap}rem\`;     // TS2322 — this app has settled on px
 * \`\`\`
 *
 * No \`as const\` is needed: the annotation is the context. It works in a getter, which is where a
 * value like this is usually made.
 *
 * **What it deliberately admits.** Any call — \`calc()\`, \`min()\`, \`clamp()\`, \`var()\` — because each
 * can produce any dimension and nothing in a type can read inside one. So \`calc(1rem + 2px)\` passes
 * \`CssDimension<"px">\`, and so would \`foo(1)\`. Refusing calls would make the type useless in the
 * one place authors reach for it.
 */
export type CssDimension<Unit extends CssUnit = CssUnit> = \`\${number}\${Unit}\` | 0 | "0" | \`\${string}(\${string})\`;
`;

const said =
  `${named.length} properties, ${unions} typed as a union, ${checkable} value-checkable by the rules, ` +
  `${propertyNamedRows.length} whose value is a property name, ${allUnits.length} units, ` +
  `${NOT_IN_A_RULE.length} at-rules that may not sit in a block, ${shorthandRows.length} shorthands, ` +
  `${valueRows.length} with values to suggest, ${Object.keys(ABBREVIATIONS).length} abbreviated`;

if (!check) {
  writeFileSync(TYPES, types);
  writeFileSync(KEYWORDS, keywords);
  writeFileSync(DIMENSIONS, units);
  console.log(`[css-properties] wrote ${said}`);
  process.exit(0);
}

if (
  readFileSync(TYPES, "utf8") === types &&
  readFileSync(KEYWORDS, "utf8") === keywords &&
  readFileSync(DIMENSIONS, "utf8") === units
) {
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
