import { type Config } from "../../config/config";
import { type Finding, checkBlock } from "../../compiler/rules";
import { KEYWORDS } from "../../compiler/keywords.generated";
import { canonicalValue } from "../../compiler/normalise";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { namedSites } from "../../compiler/references";
import { readBlock } from "../../compiler/read";
import { transform } from "../../compiler/transform";
import { check, checkNamedFree, messages, messagesWith, rules, rulesWith } from "./helpers";

describe("a bare word a property does not accept", () => {
  test("is named, with the nearest one that exists", () => {
    const [only, ...rest] = check("  display: flexx;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-value");
    expect(only.message).toContain("flexx");
    expect(only.message).toContain("flex");
  });

  test("inside a shorthand too, where the types can say nothing at all", () => {
    // `border-left` is `<line-width> || <line-style> || <color>` — it never resolves to a keyword
    // list, but neither a length nor a colour function can BE a bare word, so this one is provable.
    expect(messages("  border-left: 4px sollid red;")[0]).toContain("solid");
  });

  test("and in a nested rule", () => {
    expect(rules("  &:hover { display: flexx; }")).toEqual(["unknown-value"]);
  });

  test.each([
    ["a combination the grammar allows", "  display: inline flow-root;"],
    ["a CSS-wide keyword", "  display: inherit;"],
    ["another one", "  display: revert-layer;"],
    ["an important flag", "  display: flex !important;"],
    ["a custom property standing in", "  display: var(--how);"],
    ["one with a fallback", "  display: var(--how, flex);"],
    ["a length", "  padding: 24px;"],
    ["a hex colour", "  color: #10b981;"],
    ["a function", "  color: rgb(0 0 0 / 50%);"],
    ["a named colour", "  border-left: 1px solid rebeccapurple;"],
    ["a word inside a string", `  content: "flexx";`],
    ["a property whose values are the author's own", "  animation-name: slidein;"],
    ["another", "  font-family: Helvetica, sans-serif;"],
    ["a grid area the author named", "  grid-area: myarea;"],
    ["a custom property, whose value is anything", "  --brand: whatever-i-like;"],
    ["a vendor-prefixed property", "  -webkit-box-orient: vertical;"],
    ["a vendor-prefixed VALUE, which is the same argument one level down", "  display: -webkit-box;"],
    ["another, on a property whose row is long enough to suggest from", "  cursor: -webkit-grab;"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test.each([
    ["a function with a string in it", `  transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1);`],
    ["a nested function", "  transform: translate(calc(100% - 4px), 0);"],
    ["a string inside a function", `  display: nonsense("flexx");`],
  ])("%s is silent", (_what, css) => {
    // Each of these is a shape the word reader has to STEP OVER rather than judge: a string's
    // contents and a function's arguments are their own grammars.
    expect(rules(css)).toEqual([]);
  });

  /**
   * The word reader still steps over a string's contents, and something else reads the QUOTES —
   * see `string-not-allowed`. What is inside them was never this rule's business and is not now.
   */
  test.each([
    ["a string where the grammar allows none", `  display: "flexx";`],
    ["an escaped quote inside one", `  display: "a\\"b";`],
  ])("%s is not a word, and is reported as a string", (_what, css) => {
    expect(rules(css)).toEqual(["string-not-allowed"]);
  });

  /**
   * A string that is never closed swallows the rest of the block, and `string-not-allowed` is what
   * explains that — so `missing-semicolon` stays quiet, as it does wherever another rule has already
   * spoken about the same declaration.
   */
  test("one that is never closed is not a word, and is reported as a string", () => {
    expect(rules(`  display: "flexx`)).toEqual(["string-not-allowed"]);
  });

  /**
   * A unit typo is not the WORD reader's business, and that boundary still holds: `10pxx` starts
   * with a digit, so nothing here reads it as a bare identifier. It is reported by `unknown-unit`
   * instead — see the section on it — which needs no value grammar because it asks a different
   * question: not "is this valid" but "is this one edit from something valid".
   */
  test("a unit typo is not a bare word, and is left to the rule that reads numbers", () => {
    expect(rules("  padding: 10pxx;")).toEqual(["unknown-unit"]);
  });
});

/**
 * A property whose value is a name the author writes with TWO dashes — and the eighteen that were
 * excluded from checking because of it.
 *
 * The generator's `FREE` set answers one question: can a bare word here be something nobody can
 * judge. `<custom-ident>` makes it so — `animation-name: slidein` is the author's own word. A
 * `<dashed-ident>` does NOT, for the same reason a `url()` and a `<string>` do not: the shape is
 * decidable before anybody reads a vocabulary. It starts with `--`, and the rule above skips it.
 *
 * So the anchor, timeline and position families are checkable, and `position-area` was the sharpest
 * case: its grammar is a CLOSED keyword set of forty-one words, and `position-area: topp` passed.
 */
describe("a property whose value is a dashed name", () => {
  test.each([
    ["an anchor the author named", "  anchor-name: --card;"],
    ["a reference to one", "  position-anchor: --card;"],
    ["a scope", "  anchor-scope: --card;"],
    ["two of them", "  timeline-scope: --a, --b;"],
    ["a view timeline", "  view-timeline-name: --reveal;"],
    ["a scroll timeline", "  scroll-timeline-name: --scroller;"],
    ["an animation reading one", "  animation-timeline: --scroller;"],
    ["a font palette", "  font-palette: --duo;"],
    ["a keyword on the same property", "  font-palette: dark;"],
    ["a fallback the author named", "  position-try-fallbacks: --narrow;"],
    ["a keyword pair from a closed grammar", "  position-area: top span-all;"],
    ["another", "  position-area: block-start center;"],
    ["the keyword these all also take", "  anchor-name: none;"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test.each([
    ["a typo in a closed grammar", "  position-area: topp;", "top"],
    ["a typo of the keyword", "  anchor-name: nonee;", "none"],
    ["a typo of a palette keyword", "  font-palette: lightt;", "light"],
    ["a typo where a timeline is named", "  animation-timeline: nonee;", "none"],
    ["a typo of a fallback keyword", "  position-try-fallbacks: flip-blockk;", "flip-block"],
  ])("%s is reported, with the word that exists", (_what, css, meant) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-value");
    expect(only.message).toContain(meant);
  });
});

/**
 * A property that accepts NO keyword at all, which nothing was checking.
 *
 * ## The fault this exists for
 *
 * Measured: `padding: auto` and `padding: red` both passed. `padding`'s grammar is
 * `<'padding-top'>{1,4}` and reaches no bare word, so the generator emitted no row for it — and a
 * property with no row is one this rule skips. Seventy properties were in that state, and every one
 * of them is numeric: `padding` and its longhands, `scroll-margin` and its longhands, the four
 * `border-*-radius`, `opacity`, `order`, `flex-grow`, `flex-shrink`, `transition-duration`,
 * `tab-size`, the SVG geometry properties.
 *
 * **No keyword is valid for any of them**, so an empty row says more than no row: every bare word is
 * wrong. The CSS-wide keywords are still fine, because they are fine everywhere.
 */
describe("a property that takes no keywords", () => {
  test.each([
    ["padding", `padding: auto;`, "auto"],
    ["padding", `padding: red;`, "red"],
    ["opacity", `opacity: half;`, "half"],
    ["flex-grow", `flex-grow: auto;`, "auto"],
    ["transition-duration", `transition-duration: fast;`, "fast"],
    ["border-radius", `border-radius: round;`, "round"],
  ])("%s refuses a bare word", (property, css, word) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-value");
    expect(only.message).toContain(word);
    expect(only.message).toContain(property);
  });

  test.each([
    ["a length", `padding: 4px 0;`],
    ["a percentage", `padding: 10%;`],
    ["a number", `opacity: 0.5;`],
    ["a time", `transition-duration: 150ms;`],
    ["a CSS-wide keyword", `padding: inherit;`],
    ["a variable", `padding: var(--x);`],
    ["a calculation", `padding: calc(100% - 8px);`],
  ])("%s is fine", (_what, css) => {
    expect(check(css)).toEqual([]);
  });

  /** A hole has no unit to read, so this rule says nothing about one — `hole-not-allowed` does. */
  test.each([
    ["a hole", `padding: $(size);`],
    ["a hole with a space after it", `padding: $(size) 0;`],
  ])("%s is not this rule's business", (_what, css) => {
    expect(check(css).map((one) => one.rule)).toEqual(["hole-not-allowed"]);
  });
});

/**
 * A property whose value is a PROPERTY NAME, which nothing was checking.
 *
 * ## The fault this exists for
 *
 * Measured — every one of these reported nothing: `transition-property: bordr-left-width`,
 * `will-change: bordr-left-width`. Both grammars admit a free identifier, and the honest exclusion
 * for a free identifier is to skip the property entirely, because nothing can tell a name somebody
 * invented from a name somebody mistyped.
 *
 * **Except here the identifier is not free at all.** It is a property name, and that is a closed set
 * this package already generates — 551 of them.
 *
 * ## Why it is a list rather than something derived
 *
 * `mdn-data` does not say so. Measured: `transition-property` is `none | <single-transition-property>#`
 * and `<single-transition-property>` is `all | <custom-ident>` — a free identifier, with nothing in
 * the grammar to mark it as a property name. The prose in the specification says it; the machine
 * readable form does not. So the two properties are named, with this note, rather than inferred.
 *
 * The `transition` SHORTHAND is deliberately not among them: its value mixes a property, two times
 * and an easing function in one list, and telling which word is which needs a model of the grammar
 * rather than a set of names.
 */
describe("a value that has to be a property name", () => {
  test.each([
    ["transition-property", `transition-property: bordr-left-width;`, "border-left-width"],
    ["will-change", `will-change: trnasform;`, "transform"],
  ])("%s suggests the name that was meant", (property, css, meant) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-value");
    expect(only.message).toContain(property);
    expect(only.message).toContain(meant);
  });

  test.each([
    ["a real property", `transition-property: border-left-width;`],
    ["two of them", `transition-property: opacity, transform;`],
    ["a keyword the grammar lists", `transition-property: all;`],
    ["another", `transition-property: none;`],
    ["will-change's own keywords", `will-change: scroll-position, contents;`],
    ["auto", `will-change: auto;`],
    ["a vendor-prefixed property", `transition-property: -webkit-transform;`],
    ["a custom property, which is animatable", `transition-property: --brand-colour;`],
    ["a CSS-wide keyword", `transition-property: inherit;`],
  ])("%s is fine", (_what, css) => {
    expect(check(css)).toEqual([]);
  });

  test("a hole names no property, so this rule says nothing about one", () => {
    expect(check(`transition-property: $(what);`).map((one) => one.rule)).toEqual(["hole-not-allowed"]);
  });

  /**
   * The `transition` SHORTHAND, checked by elimination rather than by a model of its grammar.
   *
   * Its value mixes a property, two times and an easing function in one comma-separated list, and
   * nothing here parses that. It does not have to: every bare word in it is one of four things, and
   * three of them are sets this package already generates — `transition-property`'s `all` and
   * `none`, `transition-timing-function`'s seven keywords, `transition-behavior`'s two. A time is
   * not a bare word and `cubic-bezier( … )` is a function, so both are stepped over. **What is left
   * is a property name**, and that is the closed set too.
   *
   * `animation` is deliberately not treated the same way: `animation-name` is a genuinely free
   * identifier — the author's own `@keyframes` — so there is nothing to check it against.
   */
  test.each([
    ["a typo in the property", `transition: bordr-left-width 150ms ease-in-out;`, "border-left-width"],
    ["a typo in the second item", `transition: opacity 1s, trnsform 2s;`, "transform"],
  ])("%s is reported", (_what, css, meant) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.message).toContain(meant);
  });

  test.each([
    ["a property and a time", `transition: border-left-width 150ms ease-in-out;`],
    ["two items", `transition: opacity 1s ease, transform 2s linear;`],
    ["all", `transition: all 0.3s;`],
    ["none", `transition: none;`],
    ["a cubic-bezier", `transition: opacity 1s cubic-bezier(0.4, 0, 0.2, 1);`],
    ["steps()", `transition: opacity 1s steps(4, end);`],
    ["allow-discrete", `transition: display 1s allow-discrete;`],
    ["a custom property being transitioned", `transition: --brand 1s;`],
    ["a vendor-prefixed property", `transition: -webkit-transform 1s;`],
    ["a variable", `transition: var(--motion);`],
  ])("%s is fine", (_what, css) => {
    expect(check(css)).toEqual([]);
  });

  /** `animation` stays out, and the test says so rather than leaving it to be discovered. */
  test("animation is not checked this way, because a keyframes name is the author's own", () => {
    expect(check(`animation: slidein 1s ease-in-out;`)).toEqual([]);
  });
});

/**
 * A unit that is nearly one — `150oms`, `10pxx`.
 *
 * ## Why this is a NEAR MISS and not a membership test
 *
 * The obvious rule is "the unit must be one CSS has", and it is the one failure a checker does not
 * survive: **`mdn-data`'s unit list is incomplete.** Measured — thirty units, and it is missing `lh`,
 * `rlh`, every container-query unit, every viewport variant (`svh`, `dvh`, `lvh`, …) and `%`. A rule
 * built straight from it would report `height: 100dvh` and `padding: 1cqw`, which are correct CSS.
 *
 * So the known set is mdn-data's thirty plus a written-down supplement, and even then the rule only
 * speaks when the unit is a near miss of a known one — the same bound `nearest()` uses everywhere
 * else. An unknown-but-plausible unit stays silent, and a unit invented after this was written never
 * earns a false report.
 */
describe("a unit that is nearly one", () => {
  test.each([
    ["a time", `transition-duration: 150oms;`, "ms"],
    ["a length", `padding: 10pxx;`, "px"],
    ["a font-relative one", `font-size: 1remm;`, "rem"],
    ["a viewport one", `width: 100vww;`, "vw"],
  ])("%s is reported with the one that was meant", (_what, css, meant) => {
    const found = check(css).filter((finding) => finding.rule === "unknown-unit");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(meant);
  });

  test.each([
    ["px", `padding: 10px;`],
    ["a percentage", `width: 50%;`],
    ["no unit at all", `opacity: 0.5;`],
    ["zero", `padding: 4px 0;`],
    ["ms", `transition-duration: 150ms;`],
    ["a container query unit", `padding: 1cqw;`],
    ["a dynamic viewport unit", `height: 100dvh;`],
    ["a small viewport unit", `height: 100svh;`],
    ["a line-height unit", `margin: 1lh;`],
    ["fr", `grid-template-columns: 1fr 2fr;`],
    ["a hex colour", `color: #10b981;`],
    ["a number inside a function", `width: calc(100% - 8px);`],
    ["a unit beside a hole", `border-left: $(w)px solid red;`],
    ["an angle", `rotate: 45deg;`],
    ["a resolution", `image-resolution: 300dpi;`],
  ])("%s is silent", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "unknown-unit")).toEqual([]);
  });

  /**
   * A membership test, and it began as a near miss that was too weak: measured on what a person
   * actually types, `150xxms` and `150asdasdms` both passed, because neither is within an edit or two
   * of `ms`. The caution behind that was mdn-data's incomplete list, and the supplement is what
   * answers it — every exotic real unit is in the set.
   */
  test.each([
    ["nothing near", `width: 10zzzz;`],
    ["a unit with letters in front", `transition-duration: 150xxms;`],
    ["and a lot of them", `transition-duration: 150asdasdms;`],
  ])("%s is reported, with no suggestion it cannot make", (_what, css) => {
    const found = check(css).filter((finding) => finding.rule === "unknown-unit");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("is not a CSS unit");
  });
});

/**
 * A reference to a named site, checked as the TEXT it resolves to — and it must answer exactly as
 * the same text written by hand does.
 *
 * A `$(…)` that names a `@@keyframes` or `@@property` site is not a hole: it becomes text this
 * compiler decided, part of the hash, with no custom property. **So the block a checker sees is the
 * block the author would have written literally, and the two must be reported the same way.**
 *
 * They were not. Measured — the same CSS, two answers:
 *
 * | written | reported |
 * |---|---|
 * | `transform: rotate(var(--r-KJ03bK3La))` | nothing |
 * | `transform: rotate(var($(angle)))`, resolving to that name | ``transform` does not accept …` |
 *
 * The cause is that `words()` steps over a function within ONE text part, and a resolved reference
 * arrived as a part of its own — so `rotate(var(` , the name, and `))` were three parts and the
 * step-over could not span them. The name then stood alone as a bare word in a value.
 *
 * The fix is not to teach the scanner to span parts. It is that **a resolved part holds the
 * COMPILER's text, not the author's**: a name this compiler generated cannot be a typo of anything,
 * and there is no position in the author's file to point a squiggle at. So nothing in it is read.
 *
 * This shipped as a false report in `ramonda-check` before the build ran the checker at all. Making
 * the build refuse findings is what turned it from noise into a failed build, which is how it was
 * found.
 */
describe("a reference to a named site is checked as the text it became", () => {
  /**
   * The references come from the WHOLE file and the block checked is the LAST site — which is the
   * arrangement that matters: a named site is declared in one statement and read in another, and
   * slicing the declaration away is what made the first version of this test pass against nothing.
   */
  const findings = (source: string): Finding[] => {
    const references = namedSites(source);
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    const read = readBlock(source, site.open, "C.tsx", { resolve: (name) => references.get(name) });
    return checkBlock(read.block, { at: site.at, references: references });
  };

  test("a resolved name inside `var()` reports nothing, as the literal does not", () => {
    const source =
      `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
      `const card = @@( transform: rotate(var($(angle))); );\n`;

    expect(findings(source)).toEqual([]);
  });

  test("a resolved `@@keyframes` name in `animation` reports nothing either", () => {
    const source =
      `const spin = @@keyframes( from { opacity: 0; } to { opacity: 1; } );\n` +
      `const card = @@( animation: $(spin) 3s linear; );\n`;

    expect(findings(source)).toEqual([]);
  });

  /**
   * And the author's OWN words beside a resolved one are still read — the part is skipped, not the
   * declaration. A rule that went quiet for the whole value would hide a real fault next door.
   */
  test("but a real fault in the same declaration is still reported", () => {
    const source =
      `const spin = @@keyframes( from { opacity: 0; } to { opacity: 1; } );\n` +
      `const card = @@( transition: $(spin) 3s liner; );\n`;

    expect(findings(source).map((one) => one.rule)).toContain("unknown-value");
  });
});

/**
 * A QUOTED value on a property that has no place for a string.
 *
 * **Reported by a user, and the way they hit it is the point:**
 *
 * > "kako me lako prevari intelisense i da napišem `color: "yellow";` a onda ne radi jer ne sme da
 * > se piše "yellow" sa navodnicima"
 *
 * A block's value is a TypeScript string literal in the file the editor type-checks, so the editor
 * has every reason to offer the word with quotes round it. Accepting that offer compiles, ships
 * `color:"yellow"`, and every browser drops the declaration — with nothing reported anywhere.
 * Every layer behaved reasonably and the outcome was invalid CSS.
 *
 * ## Why "no strings" is not the rule
 *
 * Two of these four are correct CSS, and a rule that could not tell them apart would be a rule that
 * reports what an author wrote:
 *
 *     color: "yellow";        invalid — the quotes are part of a CSS string
 *     display: "flex";        invalid, the same way
 *     content: "hi";          correct — a `<string>` is exactly what belongs there
 *     font-family: "Brand";   correct
 *
 * So the question is asked of the grammar: does this property reach `<string>` anywhere. That comes
 * out of the same sweep that answers every other value question — `STRING_ALLOWED`, generated, 42
 * properties of 551 — rather than a hand-kept list beside it.
 *
 * ## And why only at the top level
 *
 * `url("a.png")`, `var(--x, "…")` and `local("Brand")` put a string inside a call, where it is that
 * function's own grammar and none of this rule's business. Measured against the alternative: with
 * the depth ignored, `background-image: url("a.png")` — as ordinary as CSS gets — is reported.
 */
describe("a quoted string where the property has no place for one", () => {
  test("the user's own line", () => {
    expect(rules(`  color: "yellow";`)).toEqual(["string-not-allowed"]);
  });

  test("and the message says what to write instead", () => {
    const [only] = messages(`  color: "yellow";`);

    expect(only).toContain("color: yellow");
    expect(only).toContain("does not take a quoted string");
  });

  test("the whole string is what is underlined, quotes included", () => {
    const source = `<div className={@@(\n  color: "yellow";\n)}>x</div>`;
    const [site] = findBlocks(source);
    const [only] = checkBlock(readBlock(source, site.open, "Card.tsx", { tolerant: true }).block);

    expect(source.slice(only.at, only.at + only.length)).toBe(`"yellow"`);
  });

  test.each([
    ["a property whose value is a string", `  content: "hi";`],
    ["a font family, which is a name in quotes", `  font-family: "Brand", sans-serif;`],
    ["the areas of a grid, which are strings by design", `  grid-template-areas: "head head";`],
    ["what a truncation is drawn with", `  text-overflow: "…";`],
    ["a url, whose string is the function's own grammar", `  background-image: url("a.png");`],
    ["a fallback inside var()", `  color: var(--brand, "x");`],
    ["a custom property, whose value is anything at all", `  --brand: "whatever";`],
    ["a property nothing here knows", `  -moz-osx-font-smoothing: "grayscale";`],
    ["no string at all", "  color: yellow;"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test("a value that is entirely a hole holds no string this rule can see", () => {
    expect(rules("  color: $(brand);")).toEqual(["hole-not-allowed"]);
  });

  test("a single-quoted one is the same mistake", () => {
    expect(rules(`  color: 'yellow';`)).toEqual(["string-not-allowed"]);
  });

  test("inside a nested rule too", () => {
    expect(rules(`  &:hover {\n    color: "yellow";\n  }`)).toEqual(["string-not-allowed"]);
  });

  test("one report for one declaration, however many strings are in it", () => {
    expect(rules(`  color: "a" "b";`)).toEqual(["string-not-allowed"]);
  });

  /** A project that means it can turn it off, the same as any other rule. */
  test("silenced by the project's own config", () => {
    const source = `<div className={@@(\n  color: "yellow";\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    expect(checkBlock(read.block, { config: { rules: { "string-not-allowed": "off" } } })).toEqual([]);
  });
});

/**
 * **A KEYWORD IN CAPITALS IS THE SAME CSS, and it was reported as a value that does not exist.**
 *
 * CSS keywords are case-insensitive. Measured in Chromium over the generated table: of 314 pairs it
 * accepts, it accepts **every one of them in both cases** — zero exceptions. And measured through
 * this checker over all 897 property/keyword pairs: **897 valid declarations refused**, every one of
 * them only because the keyword was not lowercase.
 *
 *     color: RED        `color` does not accept `RED`.        which is false
 *     display: FLEX     `display` does not accept `FLEX`.     which is false
 *
 * The verdict does not change — it is still refused — but the REASON becomes true, and
 * `non-canonical-spelling` is the id this package already uses for one CSS written two ways, with
 * the formatter rewriting it. `&:HOVER`, `@MEDIA` and `@media PRINT` were already handled that way;
 * a keyword value was the case nobody had reached.
 *
 * The formatter half is not optional. The message promises `ramonda-css format` fixes it, and a rule
 * naming a fix the formatter will not make is an error with no fix — which `tooling.ts` says in its
 * own words above the line that canonicalises a prelude.
 */
describe("a keyword written in capitals", () => {
  /**
   * **And it is not reported at all now** — see `onlyCase`, decided in review pass 3.
   *
   * The finding above stands and was the right half of the answer: saying a keyword in capitals
   * DOES NOT EXIST is a lie. What it kept was the verdict, and its own note says why: *the verdict
   * does not change — it is still refused — but the REASON becomes true.* The refusal was inherited
   * from the false report, not argued for.
   *
   * Measured in pass 3: `color: currentColor` — the spelling MDN documents — failed the build, and
   * `csstype`, the shared type behind emotion, styled-components, vanilla-extract and StyleX, lists
   * `"currentColor"` outright and ends its colour with `(string & {})`, so none of them reports a
   * case at all.
   *
   * The FORMATTER still rewrites every one of these, which is the user's own condition, and
   * `case and the atomic class` below holds the part that actually mattered: one class either way.
   */
  test.each([
    ["color", "RED"],
    ["display", "FLEX"],
    ["background-image", "NONE"],
    ["overflow", "Hidden"],
    ["text-transform", "UPPERCASE"],
  ])("%s: %s is the same CSS, and is left alone", (property, value) => {
    expect(checkNamedFree(`${property}: ${value};`)).toEqual([]);
  });

  /** Every word in the value, because a shorthand carries several. */
  test("a shorthand's keywords are all left alone", () => {
    expect(checkNamedFree("flex-flow: ROW WRAP;")).toEqual([]);
  });

  /** And a value that really is wrong is still wrong, whatever its case. */
  test.each(["color: REDD", "display: FLEXX", "overflow: HIDDENN"])("%s is still a fault", (written) => {
    const [found] = checkNamedFree(`${written};`);

    expect(found.rule).toBe("unknown-value");
  });

  /**
   * **The 154 properties TYPESCRIPT checks are a different answer, and it is a limit rather than a
   * fix.**
   *
   * `position` and `flex-direction` are typed as a closed union, so the rule stays silent on purpose
   * — a review measured `position: statik` being reported by both halves. For those, an uppercase
   * keyword is refused by `tsc`, and measured it is TS2820, which is TypeScript's own *did you mean*:
   *
   *     position: ABSOLUTE   TS2820 Type '"ABSOLUTE"' is not assignable to … Did you mean '"absolute"'?
   *
   * So the author still gets the right fix, phrased as a type error rather than as a spelling. It is
   * left that way deliberately: accepting both cases in a type means doubling 154 unions, and the
   * type map's instantiation count is FLAT today, which is the property worth keeping.
   */
  test.each(["position", "flex-direction"])("%s is TypeScript's to answer, so no rule speaks", (property) => {
    expect(KEYWORDS[property]).toBeUndefined();
    expect(checkNamedFree(`${property}: ABSOLUTE;`)).toEqual([]);
  });

  /**
   * **What may NOT be folded**, and each of these would be a corruption rather than a tidy-up.
   *
   * A url is a filename and a filename is case-sensitive; a string is the author's own bytes; a
   * custom property's value is arbitrary; and a vendor keyword is not in any generated row, so it is
   * left alone for the reason `unknown-value` already leaves it alone.
   */
  test.each([
    'background-image: url("A.PNG")',
    'content: "RED"',
    "--Accent: RED",
    "display: -webkit-BOX",
    'font-family: "Helvetica Neue"',
    'grid-template-areas: "A B"',
    "animation-name: SlideIn",
    "width: CALC(100% - 8PX)",
  ])("%s is left exactly as written", (written) => {
    const found = checkNamedFree(`${written};`).filter((one) => one.rule === "non-canonical-spelling");

    expect(found).toEqual([]);
  });

  /** A keyword already lowercase says nothing at all, which is the whole point. */
  test.each(["color: red", "display: flex", "flex-flow: row wrap"])("%s is clean", (written) => {
    expect(checkNamedFree(`${written};`)).toEqual([]);
  });
});

/**
 * **`! important` WITH A SPACE IS VALID CSS, and it was reported as a value that does not exist.**
 *
 * The value scanner steps over `!important` by skipping from the bang to the next SPACE — so a
 * space right after the bang stops the skip at the bang, and `important` is then read as a bare word
 * in the value.
 *
 *     color: red ! important;   `color` does not accept `important`.
 *
 * Measured in Chromium, which is the only authority on this: `! important`, `!  important`,
 * `!IMPORTANT` and even `!/**` + `*` + `/important` all make the declaration win, and `!importantt`
 * does not. So four of the five spellings are importance and one is a typo — and the one we refused
 * is valid.
 *
 * The pattern is the one `againstRegisteredSyntax` above already uses for the same question on a
 * custom property's value: one question, one answer.
 */
describe("the important flag", () => {
  test.each([
    ["written plainly", "color: red !important;"],
    ["with a space after the bang", "color: red ! important;"],
    ["with more whitespace", "color: red  !  important;"],
    ["in capitals", "color: red !IMPORTANT;"],
    ["mixed case", "color: red !Important;"],
    ["on a custom property", "--brand: red ! important;"],
    ["on a shorthand", "padding: 4px ! important;"],
  ])("%s is CSS, not a value", (_what, written) => {
    expect(checkNamedFree(written)).toEqual([]);
  });

  /**
   * **A MISSPELT FLAG DROPS THE DECLARATION**, and nothing said so — the old scanner stepped over
   * anything after a bang, so a typo was as silent as the real thing.
   *
   * Measured in Chromium by inserting the rule and reading its declarations back:
   *
   *     color: red !important; gap: 8px;    3 declarations kept
   *     color: red !importantt; gap: 8px;   2 — the colour is gone, the gap survives
   *     color: red !urgent; …               2
   *     color: red !; …                     2
   *
   * So the author's declaration silently does not apply, which is the failure this package exists
   * for. `unknown-value` is the wrong id — the word is not a value — so this has its own.
   */
  test.each([
    ["a typo", "color: red !importantt;", "importantt"],
    ["another word", "color: red !urgent;", "urgent"],
    ["a typo after a space", "color: red ! importnat;", "importnat"],
  ])("%s drops the declaration and is reported", (_what, written, word) => {
    const found = checkNamedFree(written);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-flag");
    expect(found[0].message).toContain(word);
    // The squiggle is on the flag, not on the whole declaration.
    expect(found[0].length).toBeLessThanOrEqual(word.length + 2);
  });

  /** The bang alone is the same fault, with nothing to name. */
  test("a bang with nothing after it is reported", () => {
    const [found] = checkNamedFree("color: red !;");

    expect(found.rule).toBe("unknown-flag");
  });

  /** And a bang inside a value is not a flag at all — only a trailing one is. */
  test.each(['content: "!important";', "background: url(a!b.png);", 'content: "a ! b";'])(
    "%s carries no flag",
    (written) => {
      expect(checkNamedFree(written).filter((one) => one.rule === "unknown-flag")).toEqual([]);
    },
  );
});

/**
 * Keywords CSS spells with capitals, which the grammar's own table carries and the scanner dropped.
 *
 * `mdn-data` writes `currentColor` and the nineteen `<system-color>` names in camel case, because
 * that is how the specification prints them — and CSS keywords are ASCII case-insensitive, so every
 * one of them is correct in a stylesheet. The word scanner matched `[a-z][a-z0-9-]*`, which does two
 * wrong things at once rather than one: it drops the keyword, and where the keyword STARTS lowercase
 * it keeps the truncated prefix as a keyword of its own.
 *
 * Measured before the fix: `color` carried 150 words — the 148 named colours, `transparent`, and
 * `current`, which is not a CSS keyword at all. So `color: current` passed and `color: currentcolor`
 * was reported. Exactly backwards, on the most common colour keyword there is.
 */
describe("keywords CSS spells with capitals", () => {
  test("`currentcolor` is accepted, and it is the one this was found through", () => {
    expect(rules("color: currentcolor;")).toEqual([]);
    expect(rules("border: 1px solid currentcolor;")).toEqual([]);
    expect(rules("background-color: currentcolor;")).toEqual([]);
  });

  test("a system colour is accepted in either case, and lower case is still canonical", () => {
    expect(rules("color: buttontext;")).toEqual([]);
    expect(rules("background-color: canvas;")).toEqual([]);

    // Chrome round-trips every one of these to lower case — `ButtonText` in, `"buttontext"` out,
    // and the same for `currentColor` and even `Red`. So the table folds case and the NORMALISER
    // agrees with what the browser will do to the value anyway, rather than with how a spec prints
    // it. What changed in pass 3 is only that the case is no longer REPORTED: the spec spells these
    // `ButtonText` and `Canvas`, and failing a build on the documented spelling is the fault that
    // finding was about. `case and the atomic class` holds the guarantee that matters.
    expect(rules("color: ButtonText;")).toEqual([]);
    expect(canonicalValue("color", " ButtonText").trim()).toBe("buttontext");
  });

  test("the truncated prefix is NOT a keyword, which is the half a fix could leave behind", () => {
    expect(rules("color: current;")).toEqual(["unknown-value"]);
  });

  test("the named colours it always had are untouched", () => {
    expect(rules("color: rebeccapurple;")).toEqual([]);
    expect(rules("color: transparent;")).toEqual([]);
    expect(rules("color: notacolour;")).toEqual(["unknown-value"]);
  });
});

/**
 * `arity` — how many values a property may take here, which is a RULE and not a type.
 *
 * A type for it is a template literal over the permitted values, and measured, at 49 units by four
 * positions TypeScript silently stops checking: no `TS2590`, no message, `8pxx` simply accepted. A
 * type that quietly stops checking is worse than none, because the file stays green. The checker has
 * no threshold, and the sentence is ours to write.
 */
describe("more values than this project allows", () => {
  const ONE: Config = { properties: { "*": { arity: 1 } } };

  test("one value is silent and two are reported", () => {
    expect(rulesWith("padding: 8px;", ONE)).toEqual([]);
    expect(rulesWith("padding: 8px 12px;", ONE)).toEqual(["too-many-values"]);
  });

  test("a call is ONE value, however many spaces are inside it", () => {
    expect(rulesWith("padding: calc(1rem + 2px);", ONE)).toEqual([]);
    expect(rulesWith("color: rgb(0 0 0);", ONE)).toEqual([]);
  });

  /**
   * **The wildcard reaches only the sixteen properties an arity means something for.**
   *
   * `border-left` is `<line-width> || <line-style> || <color>`, so `4px solid red` is one value in
   * three parts rather than three values. It was reported under `"*": { arity: 1 }` before this was
   * narrowed — refusing correct CSS, which is the failure this package may not have.
   */
  test("a shorthand whose parts are different things is untouched", () => {
    expect(rulesWith("border-left: 4px solid red;", ONE)).toEqual([]);
    expect(rulesWith("background: red url(a.png) no-repeat;", ONE)).toEqual([]);
  });

  test("a property may be given its own arity, which beats the sweep", () => {
    const own: Config = { properties: { "*": { arity: 1 }, margin: { arity: 4 } } };

    expect(rulesWith("margin: 0 auto;", own)).toEqual([]);
    // `0 8px` rather than `0 auto`: `auto` is not a padding value, so that would have reported
    // `unknown-value` beside this one and the assertion would have been about two rules at once.
    expect(rulesWith("padding: 0 8px;", own)).toEqual(["too-many-values"]);
  });

  /**
   * `margin: 0 auto` under `arity: 1`, which `DESIGN.md` names as the trap in the obvious default.
   *
   * Reported, and correctly — the project asked for one value. It is here so that anybody proposing
   * `"*": { arity: 1 }` as a scaffolded default meets it in a test rather than in their own code.
   */
  test("centring with `margin: 0 auto` is reported under an arity of one", () => {
    expect(rulesWith("margin: 0 auto;", ONE)).toEqual(["too-many-values"]);
  });

  test("a hole is one value, so this rule says nothing about it", () => {
    expect(rulesWith("padding: $(gap);", ONE)).not.toContain("too-many-values");
  });

  test("no arity anywhere is silence", () => {
    expect(rulesWith("padding: 8px 12px 4px 2px;", {})).toEqual([]);
  });
});

/**
 * More values than CSS ITSELF gives the property, which needs no config at all.
 *
 * **Reported by a user**, who wrote `padding: 4px 0 0 0 0` — five values where CSS gives four — and
 * was told nothing, because this rule only ran when a config set an arity. Exceeding CSS's maximum
 * is not a project's opinion; it is invalid CSS, and the browser drops the declaration.
 *
 * The same breath found the second half: `"*": { arity: 4 }` left `padding-block: 1px 2px 3px`
 * silent, because the sweep's four is higher than the two CSS gives that property. A config may only
 * ever NARROW, and one `Math.min` answers both.
 */
describe("more values than CSS gives the property", () => {
  test("five values for `padding` are reported with no config at all", () => {
    expect(rulesWith("padding: 4px 0 0 0 0;", {})).toEqual(["too-many-values"]);
    expect(messagesWith("padding: 4px 0 0 0 0;", {})[0]).toContain("at most 4 values in CSS");
  });

  test("four are not, because that is what CSS gives it", () => {
    expect(rulesWith("padding: 4px 0 0 0;", {})).toEqual([]);
  });

  test("a property whose CSS maximum is two is held to two", () => {
    expect(rulesWith("padding-block: 1px 2px;", {})).toEqual([]);
    expect(rulesWith("padding-block: 1px 2px 3px;", {})).toEqual(["too-many-values"]);
  });

  test("a config may NARROW the maximum", () => {
    expect(rulesWith("padding: 4px 0;", { properties: { "*": { arity: 1 } } })).toEqual(["too-many-values"]);
    expect(messagesWith("padding: 4px 0;", { properties: { "*": { arity: 1 } } })[0]).toContain("in this project");
  });

  test("and may NOT widen it — the half that was silent", () => {
    const four = { properties: { "*": { arity: 4 } } } as const;

    // CSS gives `padding-block` two, so the sweep's four does not reach past it.
    expect(rulesWith("padding-block: 1px 2px 3px;", four)).toEqual(["too-many-values"]);
    expect(messagesWith("padding-block: 1px 2px 3px;", four)[0]).toContain("in CSS");
  });

  test("a property with no CSS arity is untouched without a config, as before", () => {
    expect(rulesWith("border-left: 4px solid red;", {})).toEqual([]);
    expect(rulesWith("transition: color 150ms ease-in-out;", {})).toEqual([]);
  });

  /**
   * A declaration that swallowed the next one belongs to `run-on-declaration`, which names the
   * actual fault and the missing `;`. Counting its values and speaking as well was a regression the
   * moment CSS's own maximum started applying with no config — two reports for one mistake.
   */
  test("a run-on declaration is left to the rule that explains it", () => {
    expect(rulesWith("padding: 8px\n  border-left: 4px solid red;", {})).toEqual(["run-on-declaration"]);
  });
});

/**
 * Correct CSS the slash form must not start refusing.
 *
 * Teaching `sequence` about `<type>{1,4} [ / <type>{1,4} ]?` classified ten properties, and a
 * classified property is a NARROWED property — which is where refusing correct CSS becomes
 * possible. `animation-range-start` came with it, and its value is a keyword and a percentage
 * together: `entry 50%` is valid and is the shape a narrowing gets wrong.
 *
 * Asserted with no config at all, because the shipped types must accept every one of these however
 * strict a project later chooses to be.
 */
describe("the slash form, and the correct CSS it must not refuse", () => {
  const of = (decl: string) => check(`  ${decl};`).map((one) => one.rule);

  test.each([
    ["one radius", "border-radius: 4px"],
    ["two", "border-radius: 4px 8px"],
    ["four", "border-radius: 4px 8px 12px 16px"],
    ["the elliptical form", "border-radius: 50% / 20%"],
    ["and in lengths", "border-radius: 4px / 8px"],
    ["a keyword and a percentage together", "animation-range-start: entry 50%"],
    ["its bare keyword", "animation-range-start: normal"],
    ["two ranges at once", "animation-range: entry 0% exit 100%"],
  ])("%s is silent", (_what, decl) => {
    expect(of(decl)).toEqual([]);
  });
});

/**
 * A keyword's CASE must not change the atomic class — and it did.
 *
 * The user asked for exactly this when the case REPORT was being dropped: *"potrudi se da pri buildu
 * opet bude lower case ili sta vec, da nemamo razlicit hash i atomske klase."* Measured through the
 * real transform, before any of it:
 *
 *     color: currentColor;   ->  r-c-currentColor
 *     color: currentcolor;   ->  r-c-currentcolor
 *
 * Two atomic classes, identical CSS, shipped side by side. And the hash differs with them, because
 * `identity` is built from the same text.
 *
 * **It was a live fault already**, not something the report was holding back — the report never
 * touched the build. `normalise.ts` folds a value's case through `canonicalValue`; `flatten.ts`
 * built its own canonical as `` `${property}:${collapse(value)};` `` and never called it. One
 * question, two answers, and only the one nobody looked at reached the class name.
 */
describe("case and the atomic class", () => {
  const classesOf = (css: string) => {
    const result = transform(`const a = <div className={@@(${css})}>x</div>;`, { filename: "C.tsx" });
    return [...(result?.code ?? "").matchAll(/"(r-[^"]+)"/g)].map((one) => one[1]);
  };

  test.each([
    ["a colour keyword", " color: currentColor; ", " color: currentcolor; "],
    ["a system colour", " background-color: Canvas; ", " background-color: canvas; "],
    ["an ordinary keyword", " display: FLEX; ", " display: flex; "],
    ["a shorthand's words", " flex-flow: ROW WRAP; ", " flex-flow: row wrap; "],
    ["several at once", " color: RED; overflow: Hidden; ", " color: red; overflow: hidden; "],
  ])("%s gives one class whichever case is written", (_what, written, lowered) => {
    expect(classesOf(written)).toEqual(classesOf(lowered));
  });

  test("and the emitted CSS is the same text, not merely the same name", () => {
    const of = (css: string) => transform(`const a = <div className={@@(${css})}>x</div>;`, { filename: "C.tsx" });

    expect(of(" color: currentColor; ")?.code).toBe(of(" color: currentcolor; ")?.code);
  });

  /** A value whose case the author OWNS is untouched — a font name is not a keyword. */
  test.each([
    ["a font family", " font-family: My Font; ", " font-family: my font; "],
    ["a custom property's value", " --Brand: Blue; ", " --brand: blue; "],
    ["a grid area name", " grid-area: Header; ", " grid-area: header; "],
  ])("%s keeps the author's case, so these stay two classes", (_what, written, lowered) => {
    expect(classesOf(written)).not.toEqual(classesOf(lowered));
  });
});

/**
 * A NUMBER written where only keywords go — the fault review pass 8 measured and left open.
 *
 * Every misspelled keyword was caught and a number was not, inconsistently: `position: 1` was
 * reported and `display: 1` was not. Both have a keyword set; what separated them was `PRIMITIVE`,
 * which `position` is in and `display` is not — so only one got a narrowed type refusing a number.
 *
 * **The gap could not be the rule's key.** Absence from `PRIMITIVE` means *the grammar was not
 * reduced*, not *this takes no number*, and `aspect-ratio`, `line-height` and `background-position`
 * are in the same gap with a bare number being correct CSS. So the fact is measured instead:
 * `NUMBERLESS` is the properties every one of Chromium, Firefox and WebKit refuses every bare
 * number for — 241 of them, an INTERSECTION because this says a number is wrong.
 */
describe("a number where only keywords go", () => {
  const under = (css: string) => {
    const source = `<div className={@@(\n  ${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test.each([
    ["display", "display: 1;"],
    ["position", "position: 0;"],
    ["overflow", "overflow: 1;"],
    ["white-space", "white-space: 2;"],
    ["cursor", "cursor: 1;"],
    ["float", "float: 1;"],
  ])("`%s` takes no number, and says so", (property, css) => {
    const found = under(css);

    expect(found.map((one) => one.rule)).toContain("unknown-value");
    expect(found[0].message).toContain(property);
  });

  /** A number that is CORRECT stays silent — the half a rule keyed on the gap would have broken. */
  test.each([
    ["a ratio", "aspect-ratio: 1;"],
    ["a line height", "line-height: 1.5;"],
    ["a weight", "font-weight: 700;"],
    ["a layer", "z-index: 10;"],
    ["a grow factor", "flex-grow: 1;"],
    ["an opacity", "opacity: 0.5;"],
    ["a count", "column-count: 3;"],
  ])("%s is still silent", (_what, css) => {
    expect(under(css)).toEqual([]);
  });

  /** And a keyword each of them does take is untouched, which is the control. */
  test.each([["display: flex;"], ["position: absolute;"], ["overflow: hidden;"], ["cursor: pointer;"]])(
    "`%s` is silent",
    (css) => {
      expect(under(css)).toEqual([]);
    },
  );
});

/**
 * `!important` is not a value, and counting it as one refused correct CSS.
 *
 * `padding: 4px 0 0 0 !important` is four values and a flag; the rule counted five and said CSS
 * gives four. Every finding these rules produce refuses the BUILD, so this stopped a page that
 * every browser renders. Hidden until `place-items` entered the positional table — `padding` takes
 * four, so its own flag fitted under the maximum and said nothing.
 */
describe("`!important` is not one of the values", () => {
  const found = (css: string) => {
    const source = `<div className={@@(\n  ${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {}).map((one) => one.rule);
  };

  test.each([
    ["at the maximum", "padding: 4px 0 0 0 !important;"],
    ["another family at its maximum", "margin: 1px 2px 3px 4px !important;"],
    ["a family that takes two", "place-items: start end !important;"],
    ["the spelling with a space", "padding: 4px 0 0 0 ! important;"],
    ["and in capitals", "padding: 4px 0 0 0 !IMPORTANT;"],
  ])("%s is silent", (_what, css) => {
    expect(found(css)).not.toContain("too-many-values");
  });

  /** And a value that is over the maximum WITHOUT the flag is still counted. */
  test.each([
    ["five where CSS gives four", "padding: 4px 0 0 0 0;"],
    ["five and a flag", "padding: 4px 0 0 0 0 !important;"],
  ])("%s is still reported", (_what, css) => {
    expect(found(css)).toContain("too-many-values");
  });
});

/**
 * A number a browser DROPS, which no type refuses: `gap: 12` and `z-index: 1.5`.
 *
 * Measured in Chromium, Firefox and WebKit through `CSS.supports` — see
 * `scripts/css/build-number-properties.mjs`, which writes the lists these read. Each shape below is
 * dropped by all three: the declaration is gone, the element keeps whatever it had, and nothing
 * anywhere says so.
 */
describe("a number a browser drops", () => {
  test.each([
    ["a length with no unit", "  gap: 12;"],
    ["a font size with no unit", "  font-size: 16;"],
    ["a negative one", "  letter-spacing: -1;"],
    ["a decimal one", "  width: 1.5;"],
    ["one of a box shorthand's values", "  margin: 4px 12;"],
  ])("%s is reported", (_what, css) => {
    expect(rules(css)).toContain("number-without-a-unit");
  });

  test.each([
    ["a fraction where a whole number goes", "  z-index: 1.5;"],
    ["in a column count", "  column-count: 2.5;"],
    ["in a grid line", "  grid-column: 1 / 2.5;"],
    // A whole number is a SPELLING, not a value: all three engines drop `1.0` and `1e2` for an
    // integer, which `Number.isInteger` called whole.
    ["a whole value written with a point", "  z-index: 1.0;"],
    ["a whole value written with an exponent", "  z-index: 1e2;"],
    ["one in an order", "  order: 2.0;"],
    ["one at a grid line", "  grid-row: 1.0 / 2;"],
  ])("%s is reported", (_what, css) => {
    expect(rules(css)).toContain("fraction-where-a-whole-number-goes");
  });

  /** A property name in capitals is the same property, and the browser drops its value the same way. */
  test("in a property written in capitals", () => {
    expect(rules("  GAP: 12;")).toContain("number-without-a-unit");
    expect(rules("  Z-Index: 1.5;")).toContain("fraction-where-a-whole-number-goes");
  });

  test("and a whole value with a point is offered the integer, once", () => {
    const said = messages("  z-index: 1.0;").join(" ");
    expect(said).toContain("Write `1`.");
    expect(said).not.toContain("`1` or `1`");
  });

  /** What every one of the engines accepts, and so must stay silent. */
  test.each([
    ["zero, which needs no unit", "  margin: 0;"],
    ["zero among lengths", "  padding: 0 12px;"],
    ["a length", "  gap: 12px;"],
    ["a property that takes a number", "  line-height: 1.5;"],
    ["a flex factor", "  flex: 1;"],
    ["a number inside a function", "  grid-template-columns: repeat(3, 1fr);"],
    ["inside calc", "  width: calc(100% - 12px);"],
    ["a whole z-index", "  z-index: 10;"],
    ["a negative whole one", "  order: -1;"],
    ["an opacity, a number by grammar", "  opacity: 0.5;"],
    ["a shadow, whose 0 is a length", "  box-shadow: 0 0 1px red;"],
  ])("%s is silent", (_what, css) => {
    const found = rules(css);
    expect(found).not.toContain("number-without-a-unit");
    expect(found).not.toContain("fraction-where-a-whole-number-goes");
  });

  test("says what to write instead", () => {
    expect(messages("  gap: 12;").join(" ")).toContain("12px");
    expect(messages("  z-index: 1.5;").join(" ")).toMatch(/`1`.*`2`/);
  });
});
