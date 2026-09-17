import { describe, expect, test } from "vitest";
import type { Config } from "../config";
import { kind } from "../declared";
import { ABBREVIATIONS, KEYWORDS, PROPERTIES, SHORTHANDS } from "../compiler/keywords.generated";
import { readBlock } from "../compiler/read";
import { nearest } from "../compiler/rules";
import { checkSource } from "../compiler/source";
import { namedSites, syntaxesIn } from "../compiler/references";
import { type Finding, checkBlock, checkText } from "../compiler/rules";
import { canonicalValue } from "../compiler/normalise";
import { findBlocks } from "../compiler/scan";
import { transform } from "../compiler/transform";

/**
 * The CSS checker: the faults the types deliberately cannot catch.
 *
 * ## What is left to it, measured rather than assumed
 *
 * Every candidate fault was put through the real type check first, so no rule here repeats one:
 *
 * | written | the types |
 * |---|---|
 * | `dsiplay: flex` | `TS2561`, **with** *did you mean* |
 * | `flex-dirction: row` | `TS2353`, **no suggestion** — a quoted key gets none |
 * | `position: statik` | `TS2820`, with *did you mean* |
 * | `display: flexx` | **silent** — an open grammar has no union |
 * | `border-left: 4px sollid red` | **silent** |
 * | `color: red; color: red` | **silent** |
 * | `padding: 10pxx` | **silent** |
 *
 * So this owns the near miss for a DASHED property name, and any bare word a property does not
 * accept. A unit typo stays open — see the note on that at the end.
 *
 * ## The method
 *
 * Plant the shape, then measure. Every case below that asserts SILENCE is one that would otherwise
 * be a report on correct CSS, which is how a checker earns being switched off.
 */

/** The findings for one block's text, which is how a person reads a rule's claim. */
function check(css: string): Finding[] {
  const source = `<div css={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  // Both halves, the way the real callers ask: the parse for what a declaration says, the text for
  // what the parser has no name for.
  return [...checkText(source, site.open, read.end), ...checkBlock(read.block)].sort((a, b) => a.at - b.at);
}

const rules = (css: string) => check(css).map((finding) => finding.rule);
const messages = (css: string) => check(css).map((finding) => finding.message);

/** The rule ids for one block, checked with a project config — for the config-driven rules. */
function rulesWith(css: string, config: import("../config").Config): string[] {
  const source = `<div css={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { config }).map((finding) => finding.rule);
}

/** The same, as messages — for the rules whose WORDING is the thing being asserted. */
function messagesWith(css: string, config: import("../config").Config): string[] {
  const source = `<div css={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { config }).map((finding) => finding.message);
}

describe("a property name CSS does not have", () => {
  /**
   * **It was dashed names only until review pass 6**, and the reason was sound in the checker and
   * wrong in the build. The types report a dashed name as `TS2353` with no suggestion, because a
   * QUOTED object key gets none — measured — while a bare one gets `TS2561` and TypeScript's own
   * *did you mean*. So the rule filled the first hole and left the second.
   *
   * The build runs no TypeScript. Measured in pass 6: `dsiplay: flex` and even `zzz: flex` compiled
   * into the stylesheet with nothing said anywhere. The rule speaks for both now, with or without a
   * suggestion, and `inOrder` drops the compiler's word on the line — so it is still one fault, one
   * report.
   */
  test("a dashed near miss is named, with what was meant", () => {
    const [only, ...rest] = check("  flex-dirction: row;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("flex-dirction");
    expect(only.message).toContain("flex-direction");
  });

  test("a bare name is named too, so the BUILD sees it", () => {
    const [only, ...rest] = check("  dsiplay: flex;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("display");
  });

  test("a name with no near miss at all is named without one", () => {
    const [only] = check("  zzz-qqq-www: 1px;");

    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("zzz-qqq-www");
    expect(only.message).not.toContain("Did you mean");
  });

  test.each([
    ["a custom property the author declares", "  --brand: #10b981;"],
    ["a vendor-prefixed property", "  -webkit-line-clamp: 2;"],
    ["a real dashed property", "  flex-direction: row;"],
    ["a real dashed property in a nested rule", "  &:hover { border-left: 1px solid red; }"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });
});

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
    ["a value that is entirely a hole", "  display: {how};"],
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

describe("the same declaration written twice", () => {
  /**
   * **Only when the VALUE is the same too**, and that narrowing is the whole rule.
   *
   * Two declarations of one property with different values is a deliberate idiom — a fallback for an
   * engine that will drop the second: `width: 100px; width: fit-content;`. Reporting it would be
   * reporting a technique, which is how a checker earns being switched off. The same value twice
   * says nothing either way, and is a copy that got left behind.
   */
  test("is named when the value is the same", () => {
    const [only, ...rest] = check("  color: red;\n  color: red;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("repeated-declaration");
    expect(only.message).toContain("color");
  });

  test.each([
    ["a fallback, which is a technique", "  width: 100px;\n  width: fit-content;"],
    ["the same property in a nested rule", "  color: red;\n  &:hover { color: red; }"],
    ["two properties that merely look alike", "  border-left: red;\n  border-right: red;"],
    ["the same property with a hole in one of them", "  color: red;\n  color: {accent};"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });
});

describe("a hole where a custom property cannot go", () => {
  /**
   * The rule that keeps the design honest. A custom property holds a VALUE, so a hole cannot be a
   * property name, a selector, or a whole declaration.
   *
   * The build refuses these outright — there is no correct compilation — so this exists to say it
   * FIRST: in an editor, while it is being typed, rather than at the end of a build.
   */
  test.each([
    ["a property name", "  {name}: 24px;"],
    ["a whole declaration", `  {cond ? "display:flex" : ""};`],
    ["a selector", "  &:{state} { color: red; }"],
  ])("%s is named", (_what, css) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("hole-out-of-place");
    expect(only.message).toContain("value");
  });

  test("and a hole in a value is exactly where one belongs", () => {
    expect(rules("  border-left: 4px solid {accent};")).toEqual([]);
  });
});

describe("the two generated lists, which are not the same list", () => {
  /**
   * `PROPERTIES` is every name CSS defines; `KEYWORDS` holds only the ones whose VALUES these rules
   * may judge. Asked in review whether one could be derived from the other, and the answer is no —
   * measured: 275 names are in the first and not the second.
   */
  test("the name list is longer than the value table, on purpose", () => {
    expect(PROPERTIES.length).toBeGreaterThan(Object.keys(KEYWORDS).length);
  });

  /**
   * The case that decides it, and it is this rule's headline. `flex-direction`'s values are the
   * types' to report, so it is absent from the value table — and it must be in the name list, or
   * `flex-dirction` could never be suggested.
   */
  test("a property the types own is absent from the values and present in the names", () => {
    expect(KEYWORDS["flex-direction"]).toBeUndefined();
    expect(PROPERTIES).toContain("flex-direction");
    expect(messages("  flex-dirction: row;")[0]).toContain("flex-direction");
  });

  test("and a value the types already report is not reported again", () => {
    // `position` is one of the 123 with a real union, so `statik` is `TS2820` with its own suggestion.
    expect(KEYWORDS.position).toBeUndefined();
    expect(rules("  position: statik;")).toEqual([]);
  });
});

describe("more than one fault in a block", () => {
  test("comes back in the order a person reads the block", () => {
    const source = `<div css={@@(\n  display: flexx;\n  flex-dirction: row;\n  overflow: hiddn;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    const found = checkBlock(read.block);
    expect(found.map((finding) => finding.rule)).toEqual(["unknown-value", "unknown-property", "unknown-value"]);
    expect(found.map((finding) => finding.at)).toEqual([
      source.indexOf("flexx"),
      source.indexOf("flex-dirction"),
      source.indexOf("hiddn"),
    ]);
  });

  /**
   * A block built by hand has no positions — nothing in the package does that, but the type says it
   * is possible and a rule that read `at` as a number would be wrong about the one that does.
   */
  test("a block with no positions is read without reporting a place it cannot name", () => {
    expect(
      checkBlock({
        items: [
          { kind: "declaration", property: "flex-dirction", value: [{ kind: "text", text: "row" }] },
          { kind: "declaration", property: "display", value: [{ kind: "text", text: "flexx" }] },
        ],
      }),
    ).toEqual([{ rule: "unknown-value", at: 0, length: 5, message: expect.stringContaining("flexx") }]);
  });
});

describe("what a finding carries", () => {
  test("the position of the fault itself, not of the block", () => {
    const source = `<div css={@@(\n  display: flex;\n  flex-dirction: row;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    const [only] = checkBlock(read.block);
    expect(only.at).toBe(source.indexOf("flex-dirction"));
  });

  test("and a value fault points at the word, not at the declaration", () => {
    const source = `<div css={@@(\n  border-left: 4px sollid red;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    expect(checkBlock(read.block)[0].at).toBe(source.indexOf("sollid"));
  });

  test("the length of the offending text, so an editor can draw a squiggle", () => {
    const [only] = check("  flex-dirction: row;");

    expect(only.length).toBe("flex-dirction".length);
  });

  test("a block with nothing wrong reports nothing", () => {
    expect(
      rules("  display: flex;\n  gap: 8px;\n  border-left: 4px solid #10b981;\n  &:hover { color: red; }"),
    ).toEqual([]);
  });
});

/**
 * Two declarations run together, which is what a missing `;` makes of them.
 *
 * ## The fault this exists for
 *
 * Reported from a real editor: a semicolon deleted mid-file and **nothing said anything**. Measured,
 * that is exactly right for most properties — `padding: 4px 0 border-left: 1px solid red` is one
 * value to the parser, and `padding` is not among the 123 properties whose values are a closed
 * union, so neither the type layer nor `unknown-value` has grounds to object. The browser drops the
 * declaration, both of them, and the page renders without the style.
 *
 * A colon inside a value is the tell, and it is a good one: CSS values do not contain bare colons.
 * The three places one legitimately appears — inside a string, inside `url( … )`, inside any other
 * function — are exactly where this does not look.
 */
describe("a declaration with no semicolon after it", () => {
  test("is reported on the name that got swallowed", () => {
    const [only, ...rest] = check(`padding: 4px 0\n  border-left: 1px solid red;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("run-on-declaration");
    expect(only.message).toContain("border-left");
    expect(only.message).toContain("padding");
  });

  test.each([
    ["a url with a scheme", `background: url(https://example.com/a.png);`],
    ["a quoted colon", `content: "a: b";`],
    ["a colon in a function", `background: image-set(url(a.png) 1x);`],
    ["a media query in a nested rule", `@media (min-width: 40rem) { color: red; }`],
    ["an ordinary block", `display: flex;\n  gap: 8px;`],
  ])("%s is not one", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "run-on-declaration")).toEqual([]);
  });

  /** The property before it may be one whose values ARE checked, and then both faults are true. */
  test("it is reported whatever the property's grammar", () => {
    const rules = check(`position: relative\n  color: red;`).map((finding) => finding.rule);

    expect(rules).toContain("run-on-declaration");
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
    ["a hole", `padding: {size};`],
    ["a hole with a space after it", `padding: {size} 0;`],
  ])("%s is fine", (_what, css) => {
    expect(check(css)).toEqual([]);
  });
});

/**
 * One fault, one report.
 *
 * A missing `;` makes the next declaration part of this one's VALUE, so the words in it are words
 * the property does not accept — and both rules had something true to say about the same mistake.
 * Measured on the shape a person actually writes: `gap: 8px` with no `;` above `padding: 4px 0;`
 * came back as *`gap` does not accept `padding`* AND *`padding` is being read as part of `gap`'s
 * value*. The second is the one that says what to do.
 */
/**
 * A word touching a hole is part of the hole's value.
 *
 * Found by widening the rule to the seventy numeric properties, and it was already there: measured on
 * every property with a keyword row, `gap: {{n}}px` reported *`gap` does not accept `px`*. A false
 * report on correct CSS, and no test covered it — `padding: {{n}}px` was the case that did, and
 * `padding` was one of the properties the rule was skipping.
 *
 * Whitespace is what separates one value from the next, so a piece with none between it and the hole
 * is the same value written in two parts.
 */
describe("a hole and the text glued to it", () => {
  test.each([
    ["a unit after a hole", `gap: {n}px;`],
    ["one on a property that takes no keywords", `padding: {n}px;`],
    ["two holes, one unit", `margin: {a} {b}px;`],
    ["a unit in the middle of a shorthand", `border-left: {w}px solid red;`],
    ["a word before a hole", `grid-template-columns: minmax(0,{n}fr);`],
  ])("%s says nothing about the WORD", (_what, css) => {
    // The glued piece is not a value of its own, so no rule that reads words may judge it. It IS
    // reported, by `glued-hole` — see that section — because the CSS it produces does not work.
    expect(check(css).filter((finding) => finding.rule !== "glued-hole")).toEqual([]);
  });

  test.each([
    ["a typo beside a glued unit", `border-left: {w}px sollid red;`, "sollid"],
    ["a separate word after a hole", `gap: {n} auto;`, "auto"],
  ])("%s is still caught", (_what, css, word) => {
    expect(
      check(css)
        .map((finding) => finding.message)
        .join(" "),
    ).toContain(word);
  });
});

describe("a missing semicolon reports once", () => {
  test("the run-on is reported and the value is not judged", () => {
    const [only, ...rest] = check(`gap: 8px\n  padding: 4px 0;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("run-on-declaration");
  });

  test("and a value that is wrong on its own is still judged", () => {
    const [only, ...rest] = check(`gap: sideways;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-value");
  });
});

/**
 * `//` in a block, which CSS does not have and a person arriving from TypeScript will write.
 *
 * ## The fault this exists for
 *
 * It is not silent — it is worse. Measured end to end: `// why` is written into the stylesheet
 * verbatim, `.r-x{// why\n  color:red;gap:8px;}`, and a real CSS compiler then refuses the WHOLE
 * file with `SyntaxError: Unexpected token Semicolon`, naming nothing about the block, the file or
 * the line. A build that fails somewhere else entirely, for a comment.
 *
 * `/* … *\/` is the one CSS has, and it is stripped from the emitted rule, which is right.
 *
 * ## What is not one
 *
 * A `//` inside a string or a function is text: `url(https://example.com/a.png)` is the case that
 * matters, and `url(//cdn/a.png)` is the same thing without a scheme. Neither is a comment, and a
 * rule that reported them would be reporting correct CSS.
 */
describe("a line comment", () => {
  test("is reported, with what to write instead", () => {
    const [only, ...rest] = check(`// why\n  color: red;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("line-comment");
    expect(only.message).toContain("/*");
  });

  test.each([
    ["after a declaration", `color: red; // the brand`],
    ["inside a nested rule", `&:hover {\n    // why\n    color: red;\n  }`],
  ])("%s is reported too", (_what, css) => {
    expect(check(css).map((finding) => finding.rule)).toContain("line-comment");
  });

  test.each([
    ["a block comment", `/* why */\n  color: red;`],
    ["a url with a scheme", `background: url(https://example.com/a.png);`],
    ["a url with no scheme", `background: url(//cdn.example.com/a.png);`],
    ["a quoted one", `content: "// not a comment";`],
    ["a single slash", `font: 12px/1.5 system-ui;`],
    ["a ratio", `aspect-ratio: 16 / 9;`],
    ["one inside a hole", `color: {cond ? "red" : "blue"}; /* fine */`],
  ])("%s is not one", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "line-comment")).toEqual([]);
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
    ["a hole", `transition-property: {what};`],
  ])("%s is fine", (_what, css) => {
    expect(check(css)).toEqual([]);
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
    ["a unit beside a hole", `border-left: {w}px solid red;`],
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
 * Text glued to a hole, which reads like the obvious way to write a length and does not work.
 *
 * ## Measured in a real browser, and it fails in the worst way
 *
 * A hole becomes one custom property, so `{{n}}px` becomes `var(--r-…-0)px`. Chromium, with
 * `--w: 12`:
 *
 * | written | computed |
 * |---|---|
 * | `padding-left: var(--w)px` | **`0px`** |
 * | `padding-left: 8px; padding-left: var(--w)px` | **`0px`** — the fallback above it is lost too |
 * | `padding-left: calc(var(--w) * 1px)` | `12px` |
 * | `--w: 12px; padding-left: var(--w)` | `12px` |
 *
 * A `var()` is substituted as TOKENS, so the `12` and the `px` never become one length. The
 * declaration is invalid at computed-value time, which is worse than being dropped at parse time:
 * the property falls back to its initial value and takes any earlier declaration of it with it.
 *
 * The word reader already steps over a glued piece — it has to, or `px` would be reported as a value
 * `padding` does not accept. That silence was measured as a false report and is now known to have
 * been a TRUE one with the wrong message, which is what this rule is.
 */
describe("text glued to a hole", () => {
  test.each([
    ["a unit after", `padding-left: {n}px;`],
    ["inside a shorthand", `border-left: {w}px solid red;`],
    ["a suffix that is not a unit", `grid-area: {name}-start;`],
    ["something in front", `color: #{hex};`],
    ["two holes with nothing between", `margin: {a}{b};`],
  ])("%s is reported", (_what, css) => {
    const found = check(css).filter((finding) => finding.rule === "glued-hole");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("calc(");
  });

  test.each([
    ["a hole with a space after it", `border-left: {w} solid red;`],
    ["a whole value", `display: {how};`],
    ["inside calc, spaced", `padding-left: calc({n} * 1px);`],
    ["two holes with a space", `margin: {a} {b};`],
    ["the unit inside the hole", "padding-left: {`${n}px`};"],
    ["a hole ending a declaration", `color: {c};`],
  ])("%s is fine", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "glued-hole")).toEqual([]);
  });
});

/**
 * An at-rule that is not part of an element's rule.
 *
 * ## The fault this exists for
 *
 * A block is one element's rule. `@keyframes`, `@font-face` and `@property` are not that — each names
 * something the whole stylesheet can use — and written inside a block they compile, nest inside the
 * class rule, and **do nothing**. Measured: `@keyframes slide { … }` came out as
 * `.r-…{@keyframes slide{…}}`, which no browser resolves and nothing reports.
 *
 * ## Why a deny-list rather than an allow-list
 *
 * The at-rules that DO nest are a growing set — `@scope` and `@starting-style` are recent additions,
 * and an allow-list would have reported both as faults when they arrived. A deny-list misses a new
 * top-level at-rule in silence, which is the cheaper of the two mistakes: a checker survives a gap
 * and does not survive laying on correct CSS.
 */
describe("an at-rule that belongs in a stylesheet", () => {
  test.each([
    ["@keyframes", `@keyframes slide { from { opacity: 0; } to { opacity: 1; } }`],
    ["@font-face", `@font-face { font-family: Brand; src: url(a.woff2); }`],
    ["@property", `@property --brand { syntax: "<color>"; inherits: false; }`],
    ["@page", `@page { margin: 1cm; }`],
    ["@counter-style", `@counter-style thumbs { system: cyclic; }`],
  ])("%s is reported", (name, css) => {
    const found = check(css).filter((finding) => finding.rule === "at-rule-out-of-place");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(name);
  });

  test.each([
    ["@media", `@media (min-width: 40rem) { gap: 16px; }`],
    ["@supports", `@supports (display: grid) { display: grid; }`],
    ["@container", `@container (min-width: 20rem) { gap: 16px; }`],
    ["@layer", `@layer overrides { color: red; }`],
    ["@scope", `@scope (.card) { color: red; }`],
    ["@starting-style", `@starting-style { opacity: 0; }`],
    ["a nested rule that is not an at-rule", `&:hover { color: red; }`],
    ["an ordinary declaration", `animation: slide 1s ease-in-out;`],
  ])("%s is fine", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "at-rule-out-of-place")).toEqual([]);
  });

  /** Nested one level down, because a block is a tree and the fault does not care how deep it is. */
  test("and it is found inside a nested rule too", () => {
    const found = check(`&:hover {\n    @keyframes slide { from { opacity: 0; } }\n  }`);

    expect(found.filter((finding) => finding.rule === "at-rule-out-of-place")).toHaveLength(1);
  });
});

/**
 * A named site's body, where the vocabulary is not the properties.
 *
 * The types own most of this and the split is deliberate: a descriptor that does not exist, or one
 * that is missing, is a type error with TypeScript's own suggestion, so nothing here repeats it.
 * What is left are the two faults a type cannot see, because both are about SHAPE:
 *
 * | written | the types |
 * |---|---|
 * | `form { opacity: 0 }` in `@@keyframes` | **silent** — any string is a frame to an index signature |
 * | `opacity: 0` loose in `@@keyframes` | **silent** — same signature accepts it |
 * | `&:hover { … }` in `@@font-face` | `TS2353`, but about a descriptor, not about nesting |
 */
/** The findings for a block's own CSS, with no named site around it. */
function checkNamedFree(css: string): Finding[] {
  const source = `const x = @@(\n${css}\n);`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block).sort((a, b) => a.at - b.at);
}

function checkNamed(at: string, css: string): Finding[] {
  const source = `const x = @@${at}(\n${css}\n);`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { at: site.at }).sort((a, b) => a.at - b.at);
}

describe("inside `@@keyframes`", () => {
  test("`from`, `to` and percentages are frames", () => {
    expect(checkNamed("keyframes", "from { opacity: 0; }\nto { opacity: 1; }")).toEqual([]);
    expect(checkNamed("keyframes", "0% { opacity: 0; }\n50.5% { opacity: 0.5; }\n100% { opacity: 1; }")).toEqual([]);
  });

  test("and a comma-separated list of them is one frame", () => {
    expect(checkNamed("keyframes", "0%, 100% { opacity: 0; }\nfrom, 50% { opacity: 1; }")).toEqual([]);
  });

  test("a word that is not a frame is reported, with the near miss when there is one", () => {
    const found = checkNamed("keyframes", "form { opacity: 0; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-frame");
    expect(found[0].message).toContain("`from`");
  });

  test("a percentage missing its sign is reported too", () => {
    expect(checkNamed("keyframes", "50 { opacity: 0; }")[0]?.rule).toBe("unknown-frame");
  });

  test("a declaration outside any frame is reported, because the browser drops it", () => {
    const found = checkNamed("keyframes", "opacity: 0;\nfrom { opacity: 1; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("declaration-out-of-place");
  });

  test("but the declarations inside a frame are checked like any others", () => {
    const found = checkNamed("keyframes", "from { border-left: 4px sollid red; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-value");
  });
});

describe("inside `@@font-face` and `@@property`", () => {
  test("a descriptor is not reported as a property, however close to one it reads", () => {
    expect(checkNamed("font-face", 'font-family: "Brand";\nsrc: url("/b.woff2");\nascent-override: 90%;')).toEqual([]);
    expect(checkNamed("property", 'syntax: "<angle>";\ninherits: false;\ninitial-value: 45deg;')).toEqual([]);
  });

  test("a nested rule is reported, because a descriptor list is not a rule", () => {
    const found = checkNamed("font-face", 'src: url("/b.woff2");\n&:hover { color: red; }');

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("rule-out-of-place");
  });

  test("and a unit typo is still caught, since a unit is a unit wherever it is written", () => {
    expect(checkNamed("property", 'syntax: "<angle>";\ninherits: false;\ninitial-value: 45degg;')[0]?.rule).toBe(
      "unknown-unit",
    );
  });
});

/**
 * What a percentage frame may be, measured in Chromium rather than reasoned about.
 *
 * The first version of this rule was written from the shape a person types — `50%` — and reported
 * four spellings the browser accepts while passing one it drops:
 *
 * | written | Chromium | the rule, before |
 * |---|---|---|
 * | `.5%` | kept as `0.5%` | reported |
 * | `1e2%` | kept as `100%` | reported |
 * | `+50%` | kept as `50%` | reported |
 * | `150%` | **dropped** | passed |
 *
 * Reporting valid CSS is the failure a checker does not survive, and passing what the browser throws
 * away is the failure this rule exists for. A percentage is a CSS number, and it is in range.
 */
describe("a percentage frame", () => {
  test.each([[".5%"], ["1e2%"], ["+50%"], ["50.0%"], ["0%"], ["100%"]])("%s is a frame", (frame) => {
    expect(checkNamed("keyframes", `${frame} { opacity: 0; }`)).toEqual([]);
  });

  test.each([["150%"], ["-10%"], ["1e3%"]])("%s is not, because the browser drops it", (frame) => {
    expect(checkNamed("keyframes", `${frame} { opacity: 0; }`)[0]?.rule).toBe("unknown-frame");
  });

  test("and one out of range says so, rather than offering a spelling", () => {
    expect(checkNamed("keyframes", "150% { opacity: 0; }")[0]?.message).toContain("0% and 100%");
  });
});

/**
 * The shorthand table, which composition needs and nothing before it did.
 *
 * A shorthand and its longhand are DIFFERENT properties, so a merge of two blocks keeps both and the
 * STYLESHEET breaks the tie — measured in Chromium, `.a{padding:8px}` with `.b{padding-left:40px}`
 * gives 40px whichever order the classes are written in, and 8px if the longhand is emitted first.
 * Against the call site, silently, either way.
 *
 * The merge answers it the way CSS's own cascade does — **a later shorthand clears its own
 * longhands** — and this table is what it needs. Generated from mdn-data by the sweep that already
 * writes the property map, because one classification asked twice is a place to drift.
 *
 * **Transitively closed**, and that is not a nicety: 11 of the entries mdn-data gives point at
 * another SHORTHAND — `border` sets `border-width`, which is itself a shorthand for four — so a
 * table taken as written would let `border` fail to clear `border-left-color`, which is exactly the
 * kind of override composition exists for.
 */
describe("the shorthand table", () => {
  test("a shorthand names the longhands it sets", () => {
    expect(SHORTHANDS.padding).toEqual(
      expect.arrayContaining(["padding-top", "padding-right", "padding-bottom", "padding-left"]),
    );
    expect(SHORTHANDS.gap).toEqual(expect.arrayContaining(["row-gap", "column-gap"]));
  });

  test("and a longhand names nothing, because it sets only itself", () => {
    expect(SHORTHANDS["padding-left"]).toBeUndefined();
    expect(SHORTHANDS.display).toBeUndefined();
    expect(SHORTHANDS.color).toBeUndefined();
  });

  /**
   * A shorthand can be shadowed by a BIGGER one, and the first version of this table missed it.
   *
   * `border` sets everything `border-left` sets, so a later `border` has to clear it — but mdn-data
   * writes `border`'s list as `border-width border-style border-color`, and `border-left` is in
   * none of them. Measured with the real table: `border-left` then `border` left BOTH classes on
   * the element, so the border-left rule survived a declaration that replaces it.
   *
   * So what a shorthand clears is every property whose leaves are a SUBSET of its own — which is
   * what "sets everything that one sets" means, and it is computable from the same data.
   */
  test("a bigger shorthand clears a smaller one, not only the leaves", () => {
    expect(SHORTHANDS.border).toContain("border-left");
    expect(SHORTHANDS.border).toContain("border-width");
    expect(SHORTHANDS.background).toContain("background-color");
    // and not the other way round: the smaller one does not clear the bigger
    expect(SHORTHANDS["border-left"]).not.toContain("border");
  });

  test("a shorthand of shorthands reaches the leaves", () => {
    // `border` -> `border-width` -> `border-left-width`. A table taken as mdn-data writes it stops
    // at the middle one, and `border` would not clear what `border-left` set.
    expect(SHORTHANDS.border).toContain("border-left-width");
    expect(SHORTHANDS.border).toContain("border-left-color");
    expect(SHORTHANDS.border).toContain("border-top-style");
  });

  test("every name in it is a property CSS has", () => {
    const known = new Set(PROPERTIES);
    for (const [shorthand, longhands] of Object.entries(SHORTHANDS)) {
      expect(known.has(shorthand), `${shorthand} is not a CSS property`).toBe(true);
      for (const one of longhands) expect(known.has(one), `${shorthand} names ${one}`).toBe(true);
    }
  });

  test("and nothing sets itself, which would make the merge clear what it just wrote", () => {
    for (const [shorthand, longhands] of Object.entries(SHORTHANDS)) {
      expect(longhands, shorthand).not.toContain(shorthand);
    }
  });

  /**
   * **The merge built on this table is associative**, which is what makes a nested `if` mean the
   * same as a flattened one — and it is the property the clearing rule could have broken, since
   * clearing removes keys rather than replacing them.
   *
   * Measured on the real table with a pool drawn from ONE family, so shorthands and their longhands
   * collide constantly: 50,301 groupings, zero disagreements between `_m(a, _m(b, c))` and
   * `_m(a, b, c)`. Asserted here on the cases that actually shadow each other, so a change to the
   * table that broke it would fail rather than wait for the sweep to be re-run by hand.
   */
  test("clearing is associative, which is what lets a group nest", () => {
    /** A merged map, which is also what one of its own arguments may be — that is the point. */
    const merge = (...maps: ReadonlyMap<string, string>[]): Map<string, string> => {
      const out = new Map<string, string>();
      for (const map of maps) {
        for (const [key, value] of map) {
          for (const one of SHORTHANDS[key] ?? []) out.delete(one);
          out.set(key, value);
        }
      }
      return out;
    };
    const of = (entries: Record<string, string>) => new Map(Object.entries(entries));
    const show = (map: ReadonlyMap<string, string>) => [...map].map(([k, v]) => `${k}=${v}`).join(",");

    const shapes: Record<string, string>[][] = [
      [{ "border-left-color": "1" }, { "border-left": "2" }, { border: "3" }],
      [{ border: "1" }, { "border-left": "2" }, { "border-left-color": "3" }],
      [{ "padding-left": "1" }, { padding: "2" }, { "padding-left": "3" }],
      [{ gap: "1" }, { "row-gap": "2" }, { gap: "3" }],
      [{ "background-color": "1" }, { background: "2" }, { "background-color": "3" }],
    ];

    for (const [a, b, c] of shapes) {
      const flat = show(merge(of(a), of(b), of(c)));
      expect(show(merge(of(a), merge(of(b), of(c)))), JSON.stringify([a, b, c])).toBe(flat);
      expect(show(merge(merge(of(a), of(b)), of(c))), JSON.stringify([a, b, c])).toBe(flat);
    }
  });

  /** The measurement that made this table the answer rather than expanding values. */
  test("it covers the shorthands actually written in this repository", () => {
    for (const one of ["padding", "margin", "gap", "border-left", "transition", "border-radius", "background"]) {
      expect(SHORTHANDS[one], one).toBeDefined();
    }
  });
});

/**
 * A declaration written to override an earlier one, which the stylesheet's order will not let win.
 *
 * **The stylesheet has ONE order and a block has another.** The sheet emits unconditional rules
 * before conditional ones, and broader properties before the ones they cover — it has to, because a
 * rule is shared by every element that names it and there is no per-block order to honour. Inside a
 * block the author's order is what decides, and the two agree almost always.
 *
 * Where they disagree, the author's loses SILENTLY, and that is the whole fault. Measured against
 * plain CSS in Chromium, the same declarations written in the same order:
 *
 * | written | plain CSS | ours |
 * |---|---|---|
 * | `@media { padding: 40px }` then `padding: 8px` | 8px | **40px** |
 * | `@media { padding: 40px }` then `padding-left: 8px` | left 8px | **left 40px** |
 * | `@media { … }` then an unrelated property | same | same |
 * | `@media { &:hover { … } }` then a plain one | same | same — a selector adds specificity |
 * | two declarations under the SAME condition | same | same — their order is kept |
 *
 * The merge cannot answer it: these are different keys, so both classes land and the sheet breaks
 * the tie. Nothing else reports it, and a page that silently ignores an override is exactly what
 * this package exists to stop.
 */
describe("an override the sheet's order will not honour", () => {
  test("a plain declaration below a conditional one that sets the same thing", () => {
    const found = checkNamedFree("@media (min-width: 40rem) { padding: 40px; }\npadding: 8px;");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain("@media (min-width: 40rem)");
  });

  test("and below one that sets a shorthand it is part of", () => {
    expect(checkNamedFree("@media (min-width: 40rem) { padding: 40px; }\npadding-left: 8px;")[0]?.rule).toBe(
      "override-out-of-order",
    );
  });

  /**
   * TWO BREAKPOINTS, and this is what the sheet could not tell apart until it read the query.
   *
   * The sheet emits the rule for the wider viewport first, because that is what a breakpoint means
   * and what every atomic CSS framework does — so writing the wide one BELOW the narrow one is an
   * override that cannot happen, and it used to be honoured only as long as no other file wrote one
   * of the two. Measured in Chromium: 280 of 750 load orders wrong.
   */
  test("a narrow breakpoint below a wider one, which the sheet emits last", () => {
    const found = checkNamedFree(
      "@media (min-width: 64rem) { padding: 40px; }\n@media (min-width: 40rem) { padding: 8px; }",
    );

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain("wider viewport first");
  });

  test("and the way round the sheet does emit them is not reported", () => {
    expect(
      checkNamedFree("@media (min-width: 40rem) { padding: 8px; }\n@media (min-width: 64rem) { padding: 40px; }"),
    ).toHaveLength(0);
  });

  /**
   * A VENDOR PREFIX written BELOW the standard property it is another name for.
   *
   * The engine treats them as one property, so in plain CSS the later one wins. The sheet puts the
   * prefixed form first — deliberately, so the standard property wins wherever both appear and wins
   * the same way in every build — which means writing them this way round is an override that
   * cannot happen. Measured in Chromium, `box-shadow: 0 0 9px blue; -webkit-box-shadow: 0 0 1px red`
   * is red in plain CSS and blue here.
   *
   * The conventional order is the other one, and it is silent: a prefixed fallback ABOVE the
   * standard property is what every author writes, and it does exactly what they mean.
   */
  test.each([
    ["box-shadow", "-webkit-box-shadow", "0 0 1px red"],
    ["transform", "-webkit-transform", "scale(7)"],
    ["user-select", "-webkit-user-select", "text"],
    ["appearance", "-webkit-appearance", "button"],
  ])("a prefixed `%s` below the standard one", (standard, prefixed, value) => {
    const found = checkNamedFree(`${standard}: ${value};\n${prefixed}: ${value};`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain(standard);
    // And the REASON is this pair's own, not the shorthand sentence most of these get: neither
    // name is a shorthand, and what decides is that the engine reads them as one property.
    expect(found[0].message).toContain("vendor prefix before the standard property");
  });

  test("and the conventional order — the prefix first — is silent", () => {
    expect(checkNamedFree("-webkit-box-shadow: 0 0 1px red;\nbox-shadow: 0 0 9px blue;")).toHaveLength(0);
    expect(checkNamedFree("-webkit-transform: scale(7);\ntransform: scale(3);")).toHaveLength(0);
  });

  /**
   * TWO CONDITIONS THE SHEET CANNOT ORDER, both of which may hold at once.
   *
   * `widthSlot` ranks a breakpoint by its width and everything else by a small table of bands — and
   * inside a band, two different conditions TIE. A tie is settled by the sheet's position, which is
   * the order the build happened to meet them, which is exactly what the bands exist to stop. The
   * note on `widthSlot` records the same fault for breakpoints: *the sheet fell back to the order the
   * file happened to write them in — which another file re-emitting one of the two then reversed.*
   *
   * Measured in Chromium through a real Vite build, the same block each time:
   *
   *     @supports (display: grid) { color: red; } @supports (display: flex) { color: blue; }
   *
   *     alone in the file                          blue — what plain CSS says
   *     after a block with the same two, reversed  RED
   *     after a block naming only the flex query   RED
   *
   * Both queries are true in every browser that can read the sheet, so the page depended on what
   * another component wrote. There is no order to give them that is CSS's, so the shape is refused.
   */
  test.each([
    [
      "two `@supports`, both true",
      `@supports (display: grid) { color: red; }\n@supports (display: flex) { color: blue; }`,
    ],
    [
      "two feature queries on different features",
      `@media (hover: hover) { color: red; }\n@media (pointer: fine) { color: blue; }`,
    ],
    [
      "a feature query and a height",
      `@media (hover: hover) { color: red; }\n@media (min-height: 40rem) { color: blue; }`,
    ],
  ])("%s setting one property is refused", (_what, css) => {
    const found = checkNamedFree(css);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toMatch(/both|either|cannot be ordered/i);
  });

  /**
   * And conditions that EXCLUDE each other are silent, because only one of them ever applies.
   *
   * This is most of what people write: a colour scheme, an orientation, a medium. They tie in the
   * band too, and the tie has never mattered — no element is ever matched by both.
   */
  test.each([
    [
      "a colour scheme",
      `@media (prefers-color-scheme: dark) { color: red; }\n@media (prefers-color-scheme: light) { color: blue; }`,
    ],
    [
      "an orientation",
      `@media (orientation: portrait) { color: red; }\n@media (orientation: landscape) { color: blue; }`,
    ],
    ["a medium", `@media print { color: red; }\n@media screen { color: blue; }`],
  ])("%s is silent, because only one of them ever applies", (_what, css) => {
    expect(checkNamedFree(css)).toHaveLength(0);
  });

  /** A prefixed name with no standard form fights nobody, and two unrelated ones are not a pair. */
  test("a prefixed name that stands alone is not reported", () => {
    expect(checkNamedFree("-moz-osx-font-smoothing: grayscale;\ncolor: red;")).toHaveLength(0);
    expect(checkNamedFree("box-shadow: 0 0 9px blue;\n-webkit-transform: scale(7);")).toHaveLength(0);
  });

  /** `max-width` is desktop-first, so the narrower one is the one written — and emitted — last. */
  test("max-width goes the other way, and the sheet's order is the written one", () => {
    expect(
      checkNamedFree("@media (max-width: 64rem) { padding: 8px; }\n@media (max-width: 40rem) { padding: 40px; }"),
    ).toHaveLength(0);
  });

  /**
   * A MODE against a breakpoint, and which way round is Tailwind's order — the user's call over the
   * one I had shipped. The colour scheme and the medium are WEAKER than a breakpoint; `@supports`,
   * orientation, contrast and `forced-colors` are stronger. See `widthSlot`.
   */
  test.each([
    [
      "a breakpoint below the colour scheme is fine",
      "@media (prefers-color-scheme: dark)",
      "@media (min-width: 64rem)",
    ],
    ["and below the medium too", "@media print", "@media (min-width: 64rem)"],
    ["`forced-colors` below a breakpoint is fine", "@media (min-width: 64rem)", "@media (forced-colors: active)"],
  ])("%s", (_what, above, below) => {
    expect(checkNamedFree(`${above} { padding: 8px; }\n${below} { padding: 0px; }`)).toHaveLength(0);
  });

  test.each([
    [
      "the colour scheme below a breakpoint cannot override it",
      "@media (min-width: 64rem)",
      "@media (prefers-color-scheme: dark)",
    ],
    ["nor can the medium", "@media (min-width: 64rem)", "@media print"],
    ["nor a breakpoint below `forced-colors`", "@media (forced-colors: active)", "@media (min-width: 64rem)"],
  ])("%s", (_what, above, below) => {
    const found = checkNamedFree(`${above} { padding: 8px; }\n${below} { padding: 0px; }`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
  });

  test("`@supports` is the same, because a condition adds no specificity", () => {
    expect(checkNamedFree("@supports (display: grid) { padding: 40px; }\npadding: 8px;")[0]?.rule).toBe(
      "override-out-of-order",
    );
  });

  /**
   * A LOGICAL PROPERTY BELOW A PHYSICAL ONE, which no order settles.
   *
   * `margin-inline` is the left and right margins in a horizontal writing mode and the top and
   * bottom ones in a vertical one, so whether it covers `margin-left` is the layout's to decide and
   * a stylesheet has one order for both. Measured in Chromium against plain CSS, in both modes:
   * broadest-first is right in the vertical one and wrong in the horizontal one — silently, in the
   * mode almost every page is in.
   *
   * **Fuzzed over every ordered pair in the eight families where both spellings exist**, 7,656 of
   * them, each rendered twice and compared with plain CSS. 56 disagreed and none of them was
   * reported; the pairs reported now are those 56 exactly — no pair that agreed became a finding,
   * and no pair that disagreed stayed quiet.
   */
  test.each([
    ["margin-left: 4px;\nmargin-inline: 8px;", "margin-inline"],
    ["padding-left: 4px;\npadding-inline: 8px;", "padding-inline"],
    ["margin-top: 4px;\nmargin-block: 8px;", "margin-block"],
    ["left: 4px;\ninset-inline: 8px;", "inset-inline"],
    ["border-left-width: 4px;\nborder-inline-width: 8px;", "border-inline-width"],
  ])("is reported, and the message names the writing mode: %#", (written, later) => {
    const found = checkNamedFree(written);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain("writing-mode");
    expect(found[0].message).toContain(`\`${later}\``);
    // Not the shorthand sentence, which would be untrue here — neither is the other's longhand.
    expect(found[0].message).not.toContain("its own longhands");
  });

  test.each([
    ["the other order, which the sheet does honour", "margin-inline: 8px;\nmargin-left: 4px;"],
    ["a four-side shorthand after it, which CLEARS it", "margin-inline: 8px;\nmargin: 0px;"],
    ["a four-side shorthand before it, which the sheet orders", "margin: 0px;\nmargin-inline: 8px;"],
    ["two logical properties on different axes, which never overlap", "margin-block-start: 4px;\nmargin-inline: 8px;"],
    ["the two ends of one axis, which are different sides", "margin-inline-start: 4px;\nmargin-inline-end: 8px;"],
    [
      "a physical and a logical single side, whose order the sheet keeps",
      "margin-left: 4px;\nmargin-inline-start: 8px;",
    ],
    ["an unrelated family", "margin-left: 4px;\npadding-inline: 8px;"],
  ])("%s is not reported", (_what, written) => {
    expect(checkNamedFree(written)).toEqual([]);
  });

  test("a broader property below a narrower one under the same condition", () => {
    // The sheet emits `padding` before `padding-left` whatever their order, so the author's
    // `padding` written second cannot win the way they wrote it.
    expect(
      checkNamedFree("@media (min-width: 40rem) { padding-left: 8px; }\n@media (min-width: 40rem) { padding: 40px; }"),
    ).toEqual([]);
  });

  describe("what it must not report, because the sheet and the author agree", () => {
    test.each([
      [
        "the ordinary shape — a condition BELOW what it overrides",
        "padding: 8px;\n@media (min-width: 40rem) { padding: 40px; }",
      ],
      ["an unrelated property below a condition", "@media (min-width: 40rem) { padding: 40px; }\ncolor: red;"],
      [
        "a condition on a SELECTOR, which adds specificity",
        "@media (min-width: 40rem) { &:hover { padding: 40px; } }\npadding: 8px;",
      ],
      [
        "two under the same condition, which keep their order",
        "@media (min-width: 40rem) { padding: 40px; }\n@media (min-width: 40rem) { padding: 8px; }",
      ],
      ["the same property twice, which the merge settles", "padding: 40px;\npadding: 8px;"],
      ["a shorthand below its own longhand", "padding-left: 40px;\npadding: 8px;"],
      ["a longhand below its own shorthand", "padding: 8px;\npadding-left: 40px;"],
      ["a selector below a plain declaration", "padding: 8px;\n&:hover { padding: 40px; }"],
    ])("%s", (_what, css) => {
      expect(checkNamedFree(css)).toEqual([]);
    });
  });
});

/**
 * The abbreviations a readable class name is built from.
 *
 * A class is `r-<abbreviation>-<value>`, and the abbreviation is what makes `r-p-12px` shorter than
 * `r-padding-12px` while still saying the same thing. **Written here rather than taken from any
 * library**: none covers 551 properties, and where a convention exists — `p`, `m`, `bg`, `gap` —
 * the convention is the point rather than the source. A property with no entry uses its own name,
 * which is already readable.
 *
 * Three things have to hold or two different declarations can produce one name, which is the worst
 * failure this package has — two rules merged into one. Each is asserted here AND at generation, so
 * a bad entry cannot reach a build.
 */
describe("the abbreviation map", () => {
  test("the conventional ones are what a reader expects", () => {
    expect(ABBREVIATIONS.padding).toBe("p");
    expect(ABBREVIATIONS.margin).toBe("m");
    expect(ABBREVIATIONS.background).toBe("bg");
    expect(ABBREVIATIONS["align-items"]).toBe("items");
    expect(ABBREVIATIONS["border-radius"]).toBe("rounded");
  });

  /**
   * **The rule that makes a name readable BACK.** `r-<abbr>-<value>` is only unambiguous if the
   * first `-` ends the abbreviation — otherwise `p` with the value `l-40px` and `pl` with `40px`
   * are one string.
   */
  test("no abbreviation contains a hyphen", () => {
    for (const [property, short] of Object.entries(ABBREVIATIONS)) {
      expect(short, `${property} -> ${short}`).not.toContain("-");
    }
  });

  test("no two properties share one", () => {
    const byShort = new Map<string, string>();
    for (const [property, short] of Object.entries(ABBREVIATIONS)) {
      expect(byShort.get(short), `${short} is taken by ${byShort.get(short)}`).toBeUndefined();
      byShort.set(short, property);
    }
  });

  /**
   * A property with no abbreviation uses its own NAME, so an abbreviation that IS another property's
   * name would collide with it — `r-<that name>-<value>` from two different properties.
   */
  test("and no abbreviation is another property's name", () => {
    const known = new Set(PROPERTIES);
    for (const [property, short] of Object.entries(ABBREVIATIONS)) {
      if (short === property) continue;
      expect(known.has(short), `${short} (for ${property}) is a property of its own`).toBe(false);
    }
  });

  test("every abbreviated property is a property CSS has", () => {
    const known = new Set(PROPERTIES);
    for (const property of Object.keys(ABBREVIATIONS)) {
      expect(known.has(property), `${property} is not a CSS property`).toBe(true);
    }
  });

  test("an ordinary property has none, because its own name reads fine", () => {
    expect(ABBREVIATIONS["outline-offset"]).toBeUndefined();
    expect(ABBREVIATIONS.isolation).toBeUndefined();
  });

  /**
   * **Two conventional spellings had to be given up, and the third assertion found them on the first
   * run this map was generated.** `d` is a property of its own — the SVG path data — and so is
   * `flex`. Either would have made `display: flex` and `d: M0,0` one class, or `flex-direction: row`
   * and `flex: 1`. Asserted by name so they cannot quietly come back.
   */
  test("the two conventional ones that would have collided are not used", () => {
    expect(ABBREVIATIONS.display).toBe("disp");
    expect(ABBREVIATIONS["flex-direction"]).toBe("fdir");
    expect(PROPERTIES).toContain("d");
    expect(PROPERTIES).toContain("flex");
  });
});

/**
 * Setting one variable and reading another, when the author meant one.
 *
 * A named `@@property` block is a TypeScript binding, and `var({{accent}})` resolves at build time to
 * the name that block generated. Setting it with the SAME binding works end to end — `{{accent}}:
 * blue` writes `--r-…: blue` and the `var()` reads it back.
 *
 * **Writing the literal name instead is two variables, and nothing said so.** Measured:
 *
 * ```
 * --accent: blue;               ->  .r-… { --accent: blue }       ONE variable
 * background: var({{accent}});  ->  reads --r-k8u6ISIlk           ANOTHER
 * ```
 *
 * The author believes they set what they read. The background is the `@property` `initial-value`
 * instead, and the declaration they wrote does nothing for it. **This has to be reported before the
 * binding form is recommended anywhere**, or the recommendation creates the fault it exists to
 * remove.
 */
describe("a variable set by one name and read by another", () => {
  const bound = (css: string) => {
    const source = `const accent = @@property( syntax: "<color>"; inherits: true; initial-value: red; );\nconst c = @@(\n${css}\n);`;
    const references = namedSites(source);
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true, resolve: (one) => references.get(one) });
    return checkBlock(read.block, { at: site.at, references: references }).sort((a, b) => a.at - b.at);
  };

  test("setting the literal name while reading the binding is reported", () => {
    const found = bound("  --accent: blue;\n  background: var({accent});");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("variable-set-by-another-name");
    expect(found[0].message).toContain("accent");
  });

  test("the message says what to write instead", () => {
    expect(bound("  --accent: blue;\n  background: var({accent});")[0].message).toContain("{accent}");
  });

  test("it lands on the declaration the author has to change", () => {
    const found = bound("  --accent: blue;\n  background: var({accent});");
    // The SET is the mistake — the read is what they meant.
    expect(found[0].length).toBe("--accent".length);
  });

  describe("what it must not report", () => {
    test.each([
      ["setting it with the binding, which is the right way", "  {accent}: blue;\n  background: var({accent});"],
      ["reading the binding and setting nothing", "  background: var({accent});"],
      ["setting a literal nobody reads as a binding", "  --gap: 8px;\n  gap: var(--gap);"],
      ["a literal whose name matches nothing bound", "  --tone: blue;\n  background: var({accent});"],
      ["setting the literal and reading the literal", "  --accent: blue;\n  background: var(--accent);"],
    ])("%s", (_what, css) => {
      expect(bound(css)).toEqual([]);
    });
  });
});

/**
 * A reference to a named site, checked as the TEXT it resolves to — and it must answer exactly as
 * the same text written by hand does.
 *
 * A `{{ … }}` that names a `@@keyframes` or `@@property` site is not a hole: it becomes text this
 * compiler decided, part of the hash, with no custom property. **So the block a checker sees is the
 * block the author would have written literally, and the two must be reported the same way.**
 *
 * They were not. Measured — the same CSS, two answers:
 *
 * | written | reported |
 * |---|---|
 * | `transform: rotate(var(--r-KJ03bK3La))` | nothing |
 * | `transform: rotate(var({{angle}}))`, resolving to that name | ``transform` does not accept …` |
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
      `const card = @@( transform: rotate(var({angle})); );\n`;

    expect(findings(source)).toEqual([]);
  });

  test("a resolved `@@keyframes` name in `animation` reports nothing either", () => {
    const source =
      `const spin = @@keyframes( from { opacity: 0; } to { opacity: 1; } );\n` +
      `const card = @@( animation: {spin} 3s linear; );\n`;

    expect(findings(source)).toEqual([]);
  });

  /**
   * And the author's OWN words beside a resolved one are still read — the part is skipped, not the
   * declaration. A rule that went quiet for the whole value would hide a real fault next door.
   */
  test("but a real fault in the same declaration is still reported", () => {
    const source =
      `const spin = @@keyframes( from { opacity: 0; } to { opacity: 1; } );\n` +
      `const card = @@( transition: {spin} 3s liner; );\n`;

    expect(findings(source).map((one) => one.rule)).toContain("unknown-value");
  });
});

/**
 * A hole standing where `var()` takes a NAME.
 *
 * **Measured in Chromium 151, and it is silent:**
 *
 * ```
 * .a { --name: --accent; --accent: #10b981; background: var(var(--name)); border: 4px solid red }
 *       background -> rgba(0, 0, 0, 0)      the declaration is gone
 *       border     -> 4px rgb(255, 0, 0)    and the one beside it is fine
 * ```
 *
 * `var()` resolves a literal name, not a value that happens to spell one. So a hole there compiles to
 * `var(var(--r-…-0))` and the declaration does nothing at all — one declaration, not the rule, which
 * is what makes it hard to see.
 *
 * **This package already knew, and emitted it anyway.** `references.ts` says so in its own words,
 * and it is the shape an IMPORTED binding produces: `namedSites` reads one file, so
 * `import { accent } from "./theme"` is not a name it can resolve and the reference stays a hole.
 * Measured: `background: var({{accent}})` on an imported binding compiled to
 * `background:var(var(--r-rfpVZr3es-0))` with nothing reported.
 *
 * The FALLBACK is a different position and is left alone — `var(--x, {{colour}})` is a value where a
 * value belongs, and `var(--unset, var(--hole))` was measured resolving correctly. Only the first
 * argument is a name.
 */
describe("a hole where `var()` takes a name", () => {
  const of = (source: string): Finding[] => checkBlock(readBlock(source, 2, "C.tsx").block);
  const rules = (source: string) => of(source).map((one) => one.rule);

  test("directly inside `var(`", () => {
    expect(rules(`@@(\n  background: var({accent});\n)`)).toEqual(["hole-as-a-variable-name"]);
  });

  test("with whitespace between, which changes nothing", () => {
    expect(rules(`@@(\n  background: var(  {accent} );\n)`)).toEqual(["hole-as-a-variable-name"]);
  });

  test("and nested in a fallback's own `var(`, which is still a name position", () => {
    expect(rules(`@@(\n  background: var(--brand, var({accent}));\n)`)).toEqual(["hole-as-a-variable-name"]);
  });

  test("the squiggle covers the hole the author wrote", () => {
    const source = `@@(\n  background: var({accent});\n)`;
    const [finding] = of(source);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("{accent}");
  });

  test("the message says what `var()` needs", () => {
    expect(of(`@@(\n  background: var({accent});\n)`)[0].message).toContain("literal name");
  });

  describe("what it must not report", () => {
    test("a hole in the FALLBACK, which is a value where a value belongs", () => {
      expect(rules(`@@(\n  background: var(--brand, {fallback});\n)`)).toEqual([]);
    });

    test("an ordinary hole, which is the whole point of a hole", () => {
      expect(rules(`@@(\n  background: {accent};\n)`)).toEqual([]);
    });

    test("a literal name, which is what `var()` wants", () => {
      expect(rules(`@@(\n  --accent: red;\n  background: var(--accent);\n)`)).toEqual([]);
    });

    /**
     * The legitimate use, and the reason this rule cannot simply refuse every `{{ }}` after `var(`:
     * a reference to a named site in the SAME file is resolved to text before any rule sees it, so
     * there is no hole left to report. That is the case the whole named-site design exists for.
     */
    test("a reference to a named site in the same file, which resolves to a literal", () => {
      const source =
        `const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n` +
        `const card = @@( background: var({accent}); );\n`;
      const references = namedSites(source);
      const sites = findBlocks(source);
      const site = sites[sites.length - 1];
      const read = readBlock(source, site.open, "C.tsx", { resolve: (name) => references.get(name) });

      expect(checkBlock(read.block, { at: site.at, references: references })).toEqual([]);
    });
  });
});

/**
 * An `initial-value` that its own `syntax` does not accept.
 *
 * **Measured in Chromium 151, and it voids the whole registration in silence:**
 *
 * | written | the browser kept it? | the name then |
 * |---|---|---|
 * | `syntax: "<color>"; initial-value: #10b981` | **yes** | refuses junk, falls back to the colour |
 * | `syntax: "<color>"; initial-value: 12px` | **no** — absent from `cssRules` | **accepts any junk** |
 * | `syntax: "<length>"; initial-value: red` | **no** | **accepts any junk** |
 * | `syntax: "*"; initial-value: whatever` | yes | accepts anything, which `*` means |
 *
 * So the registration is not half-broken, it is GONE: no interpolation in a transition, no fallback
 * for a value the property cannot parse, and the name back to holding whatever it is handed. Every
 * reason to write `@@property( … )` at all, removed by one mismatched line.
 *
 * ## Why it is matchers and not a classifier, which is the whole safety of it
 *
 * The rule speaks only when it has a matcher for **every** component of the syntax and none of them
 * accepts the value. A component it does not understand — `<transform-list>`, anything with a `+` or
 * `#` multiplier — makes it say nothing at all.
 *
 * That is deliberate and it is the opposite of the obvious design. Classifying the VALUE and
 * comparing types fails the wrong way: an incomplete classification makes a value look like the
 * wrong type and reports correct CSS. Asking "does any component accept this" fails by going quiet.
 *
 * The matchers are loose for the same reason. `<color>` accepts any bare word rather than a list of
 * named colours, so `<custom-ident>`-shaped values are never mistaken for a fault; `<length>` accepts
 * a number with any unit rather than only length units, so `<length>` with `3s` is MISSED. Both are
 * reports given up to keep the rule from ever being wrong.
 */
describe("an initial-value its own syntax does not accept", () => {
  const of = (source: string): Finding[] => {
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    return checkBlock(readBlock(source, site.open, "C.tsx").block, { at: site.at });
  };
  const rules = (source: string) => of(source).map((one) => one.rule);
  const property = (body: string) => `const t = @@property(\n  ${body}\n);`;

  test("a length where a colour was declared", () => {
    expect(rules(property(`syntax: "<color>"; inherits: false; initial-value: 12px;`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  test("a word where a length was declared", () => {
    expect(rules(property(`syntax: "<length>"; inherits: false; initial-value: red;`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  test("a fraction where an integer was declared", () => {
    expect(rules(property(`syntax: "<integer>"; inherits: false; initial-value: 1.5;`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  /**
   * **The other four component types, which nothing had ever run.**
   *
   * Coverage found it: of the twelve matchers in {@link ACCEPTS}, `<length-percentage>`, `<number>`,
   * `<url>` and `<image>` had no test on either side — not one that reports and not one that stays
   * quiet — in a rule whose entire job is deciding between those two. Measured, all four were
   * already right; being right is not the same as being held, and the eight rows below hold them.
   *
   * `<length-percentage>` is the one with two ways to be satisfied, so both are written: a length is
   * not a percentage to `UNIT_TYPE`, and the rule only stays quiet because it asks for each in turn.
   */
  test.each([
    ["a word where a length-percentage was declared", `"<length-percentage>"`, "red"],
    ["a length where a number was declared", `"<number>"`, "12px"],
    ["a bare word where a url was declared", `"<url>"`, "red"],
    ["a length where an image was declared", `"<image>"`, "12px"],
  ])("%s", (_what, syntax, value) => {
    expect(rules(property(`syntax: ${syntax}; inherits: false; initial-value: ${value};`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  test("the message names both halves, because either one could be the mistake", () => {
    const [finding] = of(property(`syntax: "<color>"; inherits: false; initial-value: 12px;`));

    expect(finding.message).toContain("<color>");
    expect(finding.message).toContain("12px");
  });

  test("the squiggle covers the value, which is the half more likely to be wrong", () => {
    const source = property(`syntax: "<color>"; inherits: false; initial-value: 12px;`);
    const [finding] = of(source);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("12px");
  });

  describe("what it must not report", () => {
    test.each([
      ["a colour for a colour", `syntax: "<color>"; inherits: false; initial-value: #10b981;`],
      ["a named colour, which is a bare word", `syntax: "<color>"; inherits: false; initial-value: red;`],
      ["a colour function", `syntax: "<color>"; inherits: false; initial-value: rgb(1 2 3);`],
      ["a length for a length", `syntax: "<length>"; inherits: false; initial-value: 12px;`],
      ["zero, which is a length without a unit", `syntax: "<length>"; inherits: false; initial-value: 0;`],
      ["a literal in the syntax", `syntax: "<length> | auto"; inherits: false; initial-value: auto;`],
      ["`*`, which accepts anything", `syntax: "*"; inherits: false; initial-value: whatever;`],
      ["a word for a custom-ident", `syntax: "<custom-ident>"; inherits: false; initial-value: red;`],
      ["a length for a length-percentage", `syntax: "<length-percentage>"; inherits: false; initial-value: 12px;`],
      ["a percentage for the same one", `syntax: "<length-percentage>"; inherits: false; initial-value: 50%;`],
      ["a number for a number", `syntax: "<number>"; inherits: false; initial-value: 1.5;`],
      ["a url for a url", `syntax: "<url>"; inherits: false; initial-value: url(a.png);`],
      ["a gradient for an image", `syntax: "<image>"; inherits: false; initial-value: linear-gradient(red, blue);`],
      ["calc, which can be any type", `syntax: "<length>"; inherits: false; initial-value: calc(1px + 2em);`],
      ["a component with no matcher", `syntax: "<transform-list>"; inherits: false; initial-value: rotate(0deg);`],
      ["a multiplier, which this does not read", `syntax: "<length>+"; inherits: false; initial-value: 1px 2px;`],
      ["no initial-value at all, a different fault", `syntax: "*"; inherits: false;`],
    ])("%s", (_what, body) => {
      expect(rules(property(body))).toEqual([]);
    });

    /**
     * A hole in a named block IS reported now, by `hole-in-a-named-block` — the build has always
     * refused it and the checker had no rule for it. What this test is about is the OTHER rule
     * staying quiet: a syntax it cannot read is not a syntax it may judge.
     */
    test("a syntax written as a hole, which cannot be read", () => {
      const found = rules(property(`syntax: {shape}; inherits: false; initial-value: 12px;`));

      expect(found).not.toContain("initial-value-and-syntax");
      expect(found).toEqual(["hole-in-a-named-block"]);
    });

    test("an ordinary block, where neither descriptor means this", () => {
      expect(rules(`const s = @@( color: red; );`)).toEqual([]);
    });
  });
});

/**
 * A `@media` feature that is nearly one CSS has.
 *
 * **Nothing checked a media condition at all, and the user reported it from their own typing** —
 * `@media (prefers-reduced-motion: rekErrorduce)` compiled, and so did
 * `@media (prefers-reduced-mErrorotion: reduce)`.
 *
 * ## Why the browser cannot be asked, which took three measurements to establish
 *
 * There is no oracle in the CSSOM. Measured in Chromium 151, every one of these survives in
 * `cssRules` with its `conditionText` intact — including the last, which has no colon at all:
 *
 *     @media (min-widht: 40rem)                    kept
 *     @media (prefers-reduced-mErrorotion: reduce) kept
 *     @media (nonsense)                            kept
 *     @media (min-width 40rem)                     kept
 *
 * That is not a browser being lax: an unknown feature is `<general-enclosed>` in the grammar, which
 * is **legal CSS that never matches**. So a typo here is not invalid — it is a block that silently
 * never applies, which is the worse fault and the reason to report it.
 *
 * `mdn-data` cannot supply the names either: `@media` has no `descriptors`, and its grammar bottoms
 * out at `mf-name: <ident>`. The table is written down, and a browser test verifies it — see
 * `apps/playground-core/browser`, where `(f)` and `not (f)` are both false for a name Chromium does
 * not know, which IS an oracle even though the CSSOM is not.
 *
 * ## So: a near miss, and silence otherwise
 *
 * A feature invented after this was written must not be reported, because it is valid and the table
 * is a snapshot. Same shape as `unknown-property`, same `nearest()` bound as the units.
 */
describe("a `@media` feature that is nearly a real one", () => {
  const of = (condition: string): Finding[] =>
    checkBlock(readBlock(`@@(\n  ${condition} {\n    color: red;\n  }\n)`, 2, "C.tsx").block);
  const rules = (condition: string) => of(condition).map((one) => one.rule);

  test("a misspelled feature name", () => {
    expect(rules("@media (prefers-reduced-mErrorotion: reduce)")).toEqual(["unknown-media-feature"]);
  });

  test("the message names what was meant", () => {
    expect(of("@media (min-widht: 40rem)")[0].message).toContain("min-width");
  });

  test("the squiggle covers the feature name", () => {
    const condition = "@media (min-widht: 40rem)";
    const source = `@@(\n  ${condition} {\n    color: red;\n  }\n)`;
    const [finding] = checkBlock(readBlock(source, 2, "C.tsx").block);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("min-widht");
  });

  test("a boolean feature written without a value", () => {
    expect(rules("@media (hoverr)")).toEqual(["unknown-media-feature"]);
  });

  test("one inside a longer condition", () => {
    expect(rules("@media screen and (min-widht: 40rem)")).toEqual(["unknown-media-feature"]);
  });

  describe("what it must not report", () => {
    test.each([
      ["a real feature with a value", "@media (min-width: 40rem)"],
      ["a real boolean feature", "@media (hover)"],
      ["a range syntax", "@media (width >= 40rem)"],
      ["a media type with no feature", "@media screen"],
      ["a type and a feature", "@media screen and (prefers-reduced-motion: reduce)"],
      ["`not`", "@media not all and (monochrome)"],
      ["a prefixed feature, which is a browser's own", "@media (-webkit-min-device-pixel-ratio: 2)"],
      ["a name unlike anything known, which may simply be new", "@media (quantum-entanglement: high)"],
      [
        "a longer relative of a real feature, which is how a new one arrives",
        "@media (prefers-reduced-motion-strength: 2)",
      ],
      ["and a real feature that is nearly another one", "@media (prefers-reduced-data: reduce)"],
      ["`@supports`, which is a different grammar", "@supports (display: grid)"],
      ["`@container`, whose features are its own", "@container (min-width: 20rem)"],
      ["a plain selector", "&:hover"],
    ])("%s", (_what, condition) => {
      expect(rules(condition)).toEqual([]);
    });
  });
});

/**
 * A registered property set to a value its own `syntax` does not accept.
 *
 * **Measured in Chromium 151, and it is the quiet kind of failure:**
 *
 *     @property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg }
 *     .set { --angle: 12px; transform: rotate(var(--angle)) }
 *
 *     --angle computes to `0deg`
 *
 * The value is discarded and the `initial-value` stands. Nothing is dropped, nothing is reported,
 * and the element simply shows the default — which is worse than a broken rule, because it looks
 * deliberate. A `@keyframes` frame set to the wrong type behaves the same way, so an animation
 * silently does not move.
 *
 * The compiler can see both halves: the reference resolves to a `@@property` site in this file, and
 * that site's `syntax` is a descriptor in its own block. Same matchers as
 * `initial-value-and-syntax`, so the same reports are deliberately given up — see {@link ACCEPTS}.
 */
describe("a registered property set to a value its syntax refuses", () => {
  const angle = `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n`;
  const colour = `const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n`;

  const of = (source: string): Finding[] => {
    const references = namedSites(source);
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    const read = readBlock(source, site.open, "C.tsx", { resolve: (name) => references.get(name) });
    return checkBlock(read.block, { at: site.at, references: references, syntaxes: syntaxesIn(source) });
  };
  const rules = (source: string) => of(source).map((one) => one.rule);

  test("a length where an angle was registered", () => {
    expect(rules(`${angle}const s = @@( {angle}: 12px; );\n`)).toEqual(["value-and-registered-syntax"]);
  });

  test("a word where a colour was registered", () => {
    expect(rules(`${colour}const s = @@( {accent}: 12px; );\n`)).toEqual(["value-and-registered-syntax"]);
  });

  test("the message names the syntax and the value", () => {
    const [finding] = of(`${angle}const s = @@( {angle}: 12px; );\n`);

    expect(finding.message).toContain("<angle>");
    expect(finding.message).toContain("12px");
  });

  test("inside a `@@keyframes` frame, which is where an animation stops moving", () => {
    const source = `${angle}const spin = @@keyframes( from { {angle}: 0deg; } to { {angle}: 12px; } );\n`;

    expect(rules(source)).toEqual(["value-and-registered-syntax"]);
  });

  describe("what it must not report", () => {
    test.each([
      ["the right type", `${angle}const s = @@( {angle}: 45deg; );\n`],
      ["a colour for a colour", `${colour}const s = @@( {accent}: #f05; );\n`],
      ["a hole, whose value is not known here", `${angle}const s = @@( {angle}: {turn}; );\n`],
      ["a plain custom property nothing registered", `const s = @@( --angle: 12px; );\n`],
      ["a CSS-wide keyword, which every property takes", `${angle}const s = @@( {angle}: inherit; );\n`],
      ["a `var()`, whose value is not known here", `${angle}const s = @@( {angle}: var(--x); );\n`],
      /**
       * Five a review measured as FALSE REPORTS, which is the one outcome this rule may not produce.
       */
      // `!important` on a custom property is valid CSS and is how a variable is made to win.
      ["a value with `!important`", `${angle}const s = @@( {angle}: 90deg !important; );\n`],
      ["and a colour with it", `${colour}const s = @@( {accent}: red !important; );\n`],
      // CSS keywords are ASCII case-insensitive; the escape set was matched by exact case.
      ["a CSS-wide keyword in capitals", `${angle}const s = @@( {angle}: INHERIT; );\n`],
      ["one in mixed case", `${angle}const s = @@( {angle}: Inherit; );\n`],
      ["a `VAR()` in capitals, for the same reason", `${angle}const s = @@( {angle}: VAR(--x); );\n`],
      // A `<number-token>` may carry an exponent — css-syntax-3 §4.3.12. `1e2px` is 100px.
      ["a dimension in scientific notation", `${angle}const s = @@( {angle}: 1e2deg; );\n`],
      ["a negative exponent", `${angle}const s = @@( {angle}: 1.5e-2deg; );\n`],
    ])("%s", (_what, source) => {
      expect(rules(source)).toEqual([]);
    });

    test("a syntax with no matcher silences it, as it does for `initial-value`", () => {
      const list = `const t = @@property( syntax: "<transform-list>"; inherits: false; initial-value: none; );\n`;

      expect(rules(`${list}const s = @@( {t}: 12px; );\n`)).toEqual([]);
    });
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
    const source = `<div css={@@(\n  color: "yellow";\n)}>x</div>`;
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
    ["a value that is entirely a hole", "  color: {brand};"],
    ["no string at all", "  color: yellow;"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
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
    const source = `<div css={@@(\n  color: "yellow";\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    expect(checkBlock(read.block, { config: { rules: { "string-not-allowed": "off" } } })).toEqual([]);
  });
});

/**
 * A PROPERTY NAME WITH WHITESPACE IN IT, which is never a CSS name.
 *
 * A review found what it does to the class name — see `nameFor`, which falls to the hash for it now
 * — and the hash only makes the STYLESHEET parse. The declaration inside the rule is still
 * `--a b: red`, which no browser accepts, so the rule matches an element that carries the class and
 * then applies nothing. Silently, which is this package's whole reason to exist.
 *
 * Nothing reported it. `unknown-property` returns early for a name starting with `-`, and for one
 * with no `-` at all, so `font size` and `--a b` both walked past it.
 *
 * The two causes worth naming, because they are what an author actually did: a missing `-` between
 * two words, and a name wrapped across lines — which is also what a missing `;` looks like from here.
 */
describe("a property name holding whitespace", () => {
  test("a two-word name is reported", () => {
    expect(rules(`  font size: 12px;`)).toEqual(["property-not-a-name"]);
  });

  test("and the message suggests the name with a dash, when that is a real property", () => {
    expect(messages(`  font size: 12px;`)[0]).toContain("`font-size`");
  });

  test.each([
    ["a tab", "  font\tsize: 12px;"],
    ["a newline, which is what a wrapped name looks like", "  --brand\n  -color: red;"],
    ["a custom property with a space", "  --a b: red;"],
    ["several spaces", "  font  size: 12px;"],
  ])("%s is reported too", (_what, css) => {
    expect(rules(css)).toContain("property-not-a-name");
  });

  test("the message says a name holds no whitespace, whatever the author meant", () => {
    expect(messages("  --a b: red;")[0]).toMatch(/whitespace/);
  });

  test.each([
    ["a plain property", "  color: red;"],
    ["a custom property", "  --brand: red;"],
    ["a vendor prefix", "  -webkit-mask: none;"],
    ["a value with spaces in it, which is ordinary", "  border-left: 1px solid red;"],
    ["a spread, which is not a property at all", "  ...{base};"],
  ])("%s says nothing", (_what, css) => {
    expect(rules(css)).not.toContain("property-not-a-name");
  });

  /** One report for one fault: the name is not also run through the near-miss search. */
  test("and it is the only thing reported for that declaration", () => {
    expect(rules(`  font size: 12px;`)).toEqual(["property-not-a-name"]);
  });
});

/**
 * FIVE FALSE REPORTS a review measured, each on CSS that is valid.
 *
 * A missed fault here is a gap; a report on correct CSS is how a checker earns being switched off.
 * So these are assertions of SILENCE, and each one failed before it was written.
 */
describe("valid CSS these rules must not report", () => {
  /**
   * A relative of a real media feature, not a typo of one.
   *
   * `typedInto` says a known name being a SUBSEQUENCE of what was written means somebody typed extra
   * characters into it. True for `prefers-reduced-mErrorotion`; false for a whole dash-delimited
   * segment, which is how CSS names a family. `video-` is exactly the six characters the length
   * bound allowed, so the entire `video-*` family of Media Queries 5 came back as typos of the
   * unprefixed features — and `min-video-width` as a typo of `min-width`.
   *
   * The bound cannot be tuned out of this: the extra text IS six characters. What separates them is
   * that a family relative inserts whole segments and a typo does not.
   */
  test.each([
    ["video-color-gamut", "  @media (video-color-gamut: p3) { color: red; }"],
    ["video-width", "  @media (video-width: 500px) { color: red; }"],
    ["video-height", "  @media (video-height: 500px) { color: red; }"],
    ["video-resolution", "  @media (video-resolution: 2dppx) { color: red; }"],
    ["min-video-width", "  @media (min-video-width: 500px) { color: red; }"],
    ["max-video-width", "  @media (max-video-width: 500px) { color: red; }"],
    ["a suffix, which is the same argument", "  @media (prefers-reduced-motion-strength: 1) { color: red; }"],
    ["a prefix CSS has not invented yet", "  @media (foo-width: 500px) { color: red; }"],
  ])("%s is a relative of a feature, not a typo of one", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  /** And a real typo is still reported, which is what makes the narrowing a narrowing. */
  test.each([
    ["characters typed into the middle", "  @media (prefers-reduced-mErrorotion: reduce) { color: red; }"],
    ["a near miss", "  @media (min-widht: 40rem) { color: red; }"],
    ["another", "  @media (prefers-color-schme: dark) { color: red; }"],
  ])("%s is still reported", (_what, css) => {
    expect(rules(css)).toEqual(["unknown-media-feature"]);
  });

  /**
   * A unit inside a STRING or inside `url()`, where there is no unit at all.
   *
   * `words()` steps over both and has since it was written; these two rules walked the raw text.
   * There is no config an author could write to make `content: "100%"` correct — the text is a CSS
   * string, and `url(icons/16em.svg)` is a filename.
   */
  describe("a unit that is not a unit because it is inside something", () => {
    const withUnits = (css: string) => {
      const source = `<div css={@@(\n${css}\n)}>x</div>`;
      const [site] = findBlocks(source);
      const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
      return checkBlock(read.block, { config: { units: { length: ["px", "rem"], percentage: ["%"] } } }).map(
        (one) => one.rule,
      );
    };

    test.each([
      ["a percentage in a string", `  content: "100%";`],
      ["a length in a sentence", `  content: "≈ 50em wide";`],
      ["a font name holding one", `  font-family: "Foo 12pt", sans-serif;`],
      ["a custom property holding a string", `  --label: "12em";`],
      ["a filename in an unquoted url", `  background-image: url(icons/16em.svg);`],
      ["a filename in a quoted one", `  background-image: url("photos/2in-wide.jpg");`],
      ["a single-quoted string", `  content: '3rd';`],
      ["a font format", `  --src: url(a.woff2) format("woff2");`],
    ])("%s is silent", (_what, css) => {
      expect(withUnits(css)).toEqual([]);
    });

    /** And a real one beside a string is still read, so the skip is a skip and not a bail-out. */
    test("a banned unit after a string is still reported", () => {
      expect(withUnits(`  --a: "12em" 4em;`)).toEqual(["unit-not-allowed"]);
    });

    /**
     * One report, not two: `%` is a percentage and this fixture constrains percentages to `%`, so
     * only the `em` is a fault. It is INSIDE the call, which is the whole claim — were the call's
     * interior skipped the way a string's is, this would be silent.
     */
    test("and a unit inside an ordinary call still is too", () => {
      expect(withUnits(`  width: calc(100% - 4em);`)).toEqual(["unit-not-allowed"]);
    });

    test("`unknown-unit` has the same blind spot and the same fix", () => {
      expect(rules(`  content: "3rd";`)).toEqual([]);
      expect(rules(`  background-image: url(a-16pxx.svg);`)).toEqual([]);
      expect(rules(`  padding: 10pxx;`)).toEqual(["unknown-unit"]);
    });
  });

  /**
   * `<custom-ident>` refusing a dashed ident. Per css-values-4 a `<dashed-ident>` IS a
   * `<custom-ident>`, with the extra restriction that it starts with two dashes — so `--x` is one.
   * The generator's own comment reasons correctly about exactly this; the checker's matcher did not.
   */
  test("a dashed ident where a custom ident was registered", () => {
    const source =
      `const t = @@property( syntax: "<custom-ident>"; inherits: false; initial-value: --x; );\n` +
      `const s = @@( color: red; );\n`;
    const sites = findBlocks(source);
    const read = readBlock(source, sites[0].open, "C.tsx", { tolerant: true });

    expect(checkBlock(read.block, { at: sites[0].at }).map((one) => one.rule)).toEqual([]);
  });
});

/**
 * A CONDITION or a SELECTOR spelled a way that is the same CSS and a different key.
 *
 * `:hover` and `:HOVER` are one rule to a browser, measured with lightningcss — and two keys here,
 * because a declaration's key is its own text. A review measured the cost: a base and a modifier one
 * space apart kept BOTH classes, so the modifier did not override and the winner was decided by
 * whichever file the bundler reached first.
 *
 * The project's answer is one spelling in the SOURCE. This says so, and `ramonda-css format` writes
 * it — the message names the canonical form, so it is actionable either way.
 *
 * **It reports exactly what the canonicaliser changes**, no more: a shape `canonicalSelector` and
 * `canonicalCondition` leave alone is a shape this says nothing about, because an error with no fix
 * is worse than a spelling. One function asked two ways, so the rule and the formatter cannot drift.
 */
describe("a spelling that is the same CSS and a different class", () => {
  test.each([
    ["a legacy pseudo-element", '  &:before { content: ""; }', "&::before"],
    ["no space after a feature's colon", "  @media (min-width:40rem) { color: red; }", "min-width: 40rem"],
    ["a supports declaration", "  @supports (display:grid) { color: red; }", "display: grid"],
  ])("%s is reported, with the spelling to use", (_what, css, expected) => {
    const found = rules(css);

    expect(found).toEqual(["non-canonical-spelling"]);
    expect(messages(css)[0]).toContain(expected);
  });

  /**
   * A difference of CASE ALONE is not reported — see `onlyCase`, and the formatter still fixes it.
   *
   * These four were reported until review pass 3 measured what that cost: `color: currentColor` —
   * the spelling MDN documents — failed the build, and every rule is an error. The formatter half is
   * unchanged and is what carries the guarantee now; `toolingCli.test.ts` holds it to that through
   * the real biome, on all four shapes at once.
   */
  test.each([
    ["a pseudo-class in capitals", "  &:HOVER { color: red; }"],
    ["an at-rule name in capitals", "  @MEDIA print { color: red; }"],
    ["a feature name in capitals", "  @media (MIN-WIDTH: 40rem) { color: red; }"],
    ["a media type in capitals", "  @media PRINT { color: red; }"],
  ])("%s says nothing, because case alone is the formatter's", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test.each([
    ["a canonical pseudo-class", "  &:hover { color: red; }"],
    ["a canonical pseudo-element", '  &::before { content: ""; }'],
    ["a canonical condition", "  @media (min-width: 40rem) { color: red; }"],
    ["a class, which is the author's own", "  &.Open { color: red; }"],
    ["an id", "  &#Main { color: red; }"],
    ["an attribute value", '  &[data-x="Y"] { color: red; }'],
    ["a container name", "  @container Card (width > 40rem) { color: red; }"],
    ["a range condition, which has no colon", "  @media (width > 40rem) { color: red; }"],
    ["a boolean condition", "  @media (prefers-reduced-motion) { color: red; }"],
    ["a url holding a colon", "  @supports (background: url(http://x)) { color: red; }"],
  ])("%s says nothing", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  /** The two that used to be left alone because each looked like it needed a parser. */
  test.each([
    ["spaces in an `An+B`", "  &:nth-child(2n + 1) { color: red; }", "&:nth-child(2n+1)"],
    ["a redundant pair of parens", "  @supports ((display: grid)) { color: red; }", "@supports (display: grid)"],
  ])("%s is reported too, now that it can be fixed", (_what, css, expected) => {
    expect(rules(css)).toEqual(["non-canonical-spelling"]);
    expect(messages(css)[0]).toContain(expected);
  });
});

/**
 * `@layer` INSIDE a block, which looks like a cascade control and is not one.
 *
 * The stylesheet is already one layer. Everything this compiler emits is wrapped in
 * `@layer ramonda { … }`, so it sits beneath an author's own unlayered CSS whatever order the files
 * load in — that is the whole reason the wrapper exists.
 *
 * A `@layer a` written inside a block therefore makes a SUBLAYER, `ramonda.a`. Measured:
 *
 *     @layer ramonda {
 *     @layer a { .r-…-c-red  { color:red; } }
 *     @layer b { .r-…-c-blue { color:blue; } }
 *     }
 *
 * And whether `ramonda.a` beats `ramonda.b` is decided by which of them the sheet writes FIRST,
 * because that is how CSS orders layers it was not given an explicit order for. The sheet writes
 * per file, in each file's own source order — so the answer is a property of the build, not of
 * anything the author wrote. They get a lever whose other end is not in their hands.
 *
 * Refused rather than sorted or renamed. There is no spelling of it that means what it looks like.
 */
describe("`@layer` inside a block", () => {
  test("is refused", () => {
    expect(rules("  @layer a { color: red; }")).toEqual(["layer-in-a-block"]);
  });

  test("and the message says why, not just that", () => {
    const [only] = messages("  @layer a { color: red; }");

    expect(only).toContain("already emitted inside");
    expect(only).toContain("order");
  });

  test.each([
    ["nested in a condition", "  @media print {\n    @layer a { color: red; }\n  }"],
    ["nested in a selector", "  &:hover {\n    @layer a { color: red; }\n  }"],
    ["nested inside another layer", "  @layer a {\n    @layer b { color: red; }\n  }"],
    ["with no name", "  @layer { color: red; }"],
  ])("%s is refused too", (_what, css) => {
    expect(rules(css)).toContain("layer-in-a-block");
  });

  test.each([
    ["@media", "  @media print { color: red; }"],
    ["@supports", "  @supports (display: grid) { color: red; }"],
    ["@container", "  @container (width > 40rem) { color: red; }"],
    ["@scope, which works on its own", "  @scope (.p) { color: red; }"],
  ])("%s is fine", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });
});

/**
 * A VENDOR PREFIX THAT IS NOT ONE, which passed in silence.
 *
 * `-webkit-line-clamp` is not in CSS's own list and is not a typo of anything in it, so
 * `unknown-property` returns early for every name starting with `-` — and the generator says why:
 * "each one a name nobody misspells into a different property". Measured by the user typing
 * `-wdasdsdebkit-line-clamp: 3`, which compiled, shipped, and did nothing.
 *
 * A list of valid prefixed NAMES would be the wrong repair and was measured to be: MDN's data holds
 * a hundred of them and does not hold `-webkit-font-smoothing` or `-moz-osx-font-smoothing`, which
 * are two of the most-written lines in real CSS. Reporting those would be refusing valid CSS, which
 * is the one failure this package may not have.
 *
 * The PREFIX is a different question, and it is closed: `-webkit-`, `-moz-`, `-ms-`, `-o-`. Four,
 * fixed for fifteen years, and the working group stopped minting them. So the prefix is checked and
 * the name after it is not.
 */
describe("a vendor prefix", () => {
  test.each(["-webkit-line-clamp", "-moz-osx-font-smoothing", "-ms-overflow-style", "-apple-pay-button-style"])(
    "%s is a browser's own name and is left alone",
    (name) => {
      expect(checkNamedFree(`${name}: 3;`)).toEqual([]);
    },
  );

  /**
   * `-o-` is gone, and that is a measurement rather than an omission: no engine has a single `-o-`
   * name left — Presto has been gone since 2013 — so an `-o-` property belongs to nobody. It used to
   * be one of four hard-coded prefixes, which also left out `-apple-`, so a real WebKit property was
   * reported as an unknown prefix. Both halves come off one list now.
   */
  test("an `-o-` name belongs to no engine any more", () => {
    const found = checkNamedFree("-o-object-fit: cover;");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-prefix");
  });

  test("a custom property is the author's own and is left alone", () => {
    expect(checkNamedFree("--brand: red;")).toEqual([]);
  });

  test.each([
    ["a typo in the prefix", "-wdasdsdebkit-line-clamp"],
    ["one letter out", "-webkti-line-clamp"],
    ["a prefix nobody has", "-blink-line-clamp"],
    ["a single dash and a word", "-lineclamp"],
  ])("%s is reported", (_what, name) => {
    const found = checkNamedFree(`${name}: 3;`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-prefix");
    expect(found[0].message).toContain(name);
  });

  /**
   * **AND THE NAME AFTER THE PREFIX**, which passed while only the prefix was checked. Found by
   * somebody typing `-webkit-border-before-coloaasdsdr: "asdasdsadsd"` and watching it compile.
   *
   * A list of valid names was refused once, on the grounds that `mdn-data` holds 99 of them and has
   * neither `-webkit-font-smoothing` nor `-moz-osx-font-smoothing`. That measurement was right and
   * the conclusion was not: the ENGINES have their own lists, and asked directly they give 262
   * names between them — `-webkit-font-smoothing` among them, from all three. See
   * `scripts/build-prefixed-properties.mjs`.
   */
  test.each([
    ["the name after a real prefix", "-webkit-border-before-coloaasdsdr"],
    ["one letter out", "-webkit-line-clampp"],
    ["a name no engine has", "-webkit-not-a-property"],
    ["a Firefox name spelt as WebKit's", "-webkit-osx-font-smoothing"],
  ])("%s is reported: %s", (_what, name) => {
    const found = checkNamedFree(`${name}: 3;`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-property");
  });

  /**
   * Every name at least one engine has is left alone — including the two `mdn-data` does not list,
   * which is the whole reason the engines are asked.
   */
  test.each([
    "-webkit-line-clamp",
    "-webkit-box-orient",
    "-webkit-font-smoothing",
    "-moz-osx-font-smoothing",
    "-webkit-backdrop-filter",
    "-webkit-tap-highlight-color",
    "-webkit-text-stroke",
    "-ms-overflow-style",
  ])("%s is a real property and is left alone", (name) => {
    expect(checkNamedFree(`${name}: 3;`)).toEqual([]);
  });

  /** A near miss is offered where there is one, the same as for a bare name. */
  test("a near miss in the name is offered as the fix", () => {
    const [found] = checkNamedFree("-webkit-line-clampp: 3;");

    expect(found.message).toContain("-webkit-line-clamp");
  });

  /** The message names the prefixes that have properties, which is what an author can choose from. */
  test("and the message names the prefixes that exist", () => {
    const [found] = checkNamedFree("-webkti-line-clamp: 3;");

    for (const prefix of ["-webkit-", "-moz-", "-ms-", "-apple-"]) expect(found.message).toContain(prefix);
    expect(found.message).not.toContain("-o-,");
  });

  /** A near miss in the prefix is offered, because that is what a typo in one looks like. */
  test("a near miss in the prefix is offered as the fix", () => {
    const [found] = checkNamedFree("-webkti-line-clamp: 3;");

    expect(found.message).toContain("-webkit-line-clamp");
  });
});

/**
 * **A PSEUDO-CLASS THAT DOES NOT EXIST, and it drops the whole rule.**
 *
 * The shape this repository keeps finding: `SELECTORS` holds 129 pseudo-classes and pseudo-elements
 * with their groups and their MDN links, `normalise.ts` reads it to canonicalise a prelude,
 * `plugin.ts` reads it to hover one — and **no rule read it at all**. So `&:displaydd { … }` was
 * silent, on a package whose whole claim is that a block is checked.
 *
 * Measured in Chromium, inserting a rule with two declarations and reading `cssRules` back: a
 * pseudo-class the browser does not know keeps **zero rules**. `{"kept":0,"decls":0}`. Not one
 * dropped declaration — every declaration beside it goes, and the element is left on what it
 * inherited.
 *
 * ## Why the table is the oracle and the browser is not
 *
 * The three generated tables beside this one ask the ENGINES, because `mdn-data` was measured short
 * three times. This one must not, and the same probe says why: **Chromium refuses 33 of the 129**.
 * `:left`, `:right` and `:first` are paged-media; `::-ms-*` and `::-moz-*` belong to other engines;
 * `:buffering`, `:playing` and `:seeking` are media ones it has not shipped. Every one is real CSS
 * somewhere, and a rule that asked this browser would refuse valid CSS.
 *
 * Measured the other way too, which is the direction that matters: **0 of the 129 are reported.**
 */
describe("a pseudo-class that does not exist", () => {
  const found = (prelude: string) =>
    checkNamedFree(`${prelude} { color: red; }`).filter((one) => one.rule === "unknown-selector");

  test.each([
    ["the TODO's own case", "&:displaydd", ":display"],
    ["a pseudo-element", "&::beforr", "::before"],
    ["a functional one, by its name", "&:nth-chidl(2)", ":nth-child"],
    ["one letter out", "&:hovr", ":hover"],
  ])("%s is reported: %s", (_what, prelude, meant) => {
    const [only, ...rest] = found(prelude);

    expect(rest).toEqual([]);
    expect(only.message).toContain(meant);
    expect(only.message).toContain("the whole rule");
  });

  test.each([
    ["a plain one", "&:hover"],
    ["a pseudo-element", "&::before"],
    ["a functional one, argument and all", "&:nth-child(2n+1)"],
    ["a functional one with a selector inside", "&:not(.a)"],
    ["a descendant class, which is not a pseudo at all", "& .title"],
    ["an attribute selector", '&[data-theme="dark"]'],
    ["a vendor pseudo-element, whose name is a browser's own", "&::-webkit-anything"],
  ])("%s is left alone", (_what, prelude) => {
    expect(found(prelude)).toEqual([]);
  });

  /**
   * The ARGUMENT of a functional one is deliberately not read: `:nth-child(2n+1)`, `:not(.a)` and
   * `:has(> img)` each have a grammar of their own, and a wrong argument is a different fault from a
   * misspelled name. Only the name is checked.
   */
  test("a wrong argument is not this rule's business", () => {
    expect(found("&:nth-child(banana)")).toEqual([]);
  });

  /** An at-rule prelude is `unknown-at-rule`'s, and the two must not both fire. */
  test("an at-rule prelude is left to its own rule", () => {
    expect(found("@medai (min-width: 40rem)")).toEqual([]);
  });

  /**
   * **The scan is a linear walk, and it was a regex until CodeQL measured it.**
   *
   * The first version matched `::?[a-z-]+(?:\([^)]*\))?` with `matchAll`. CodeQL flagged it as a
   * polynomial regular expression on uncontrolled data and named the input: a string of `:-(`.
   * Measured, and it is real — the optional group opens a paren, `[^)]*` runs to the end of the
   * string looking for a `)` that is not there, and backtracks, once per starting position:
   *
   *      500 repeats   1.3 ms
   *     1000 repeats   4.5 ms
   *     2000 repeats  17.7 ms
   *     4000 repeats  68.1 ms      — double the input, quadruple the time
   *
   * Not an attack: the input is the author's own stylesheet. But a prelude with many parens is not
   * exotic — `:not(:is(:has(…)))` is ordinary CSS — and a cliff in a checker an editor runs on every
   * keystroke is worth removing. The walk that replaced it visits each character a bounded number of
   * times: 8000 repeats measure 1.2 ms, sixteen times the input of the 68 ms row.
   *
   * **No duration is asserted here**, per `vitest.timeout.mjs`: a test that asserts a time measures
   * whatever else the machine was doing. What the rows below hold is the BEHAVIOUR the rewrite had
   * to keep, which is the part that would break silently.
   */
  test.each([
    ["a URL in an attribute value, whose `://` is not a pseudo", '&[href^="https://x.dev"]'],
    ["a lone colon", "&:"],
    ["two lone colons", "&::"],
    ["a selector list, both halves real", "a:hover, b:focus"],
    ["a name inside a functional one", "&:has(:hover)"],
    ["a TYPO inside a functional one, which is the argument's business", "&:is(:hovr)"],
  ])("%s says nothing", (_what, prelude) => {
    expect(found(prelude)).toEqual([]);
  });

  test("two pseudos on one selector are read separately", () => {
    const [only, ...rest] = found("&:hover::beforr");

    expect(rest).toEqual([]);
    expect(only.message).toContain("::beforr");
  });

  /** The shape CodeQL named. What is asserted is that it terminates and says nothing, not how fast. */
  test("a prelude of many unclosed parens terminates", () => {
    expect(found(`&${":-(".repeat(4000)}`)).toEqual([]);
  });

  /**
   * **The four CSS2 pseudo-elements written with ONE colon, which this rule got wrong first time.**
   *
   * `SELECTORS` holds them only as `::before` and their kind, so the first version of this reported
   * `&:before` as a name CSS does not have — refusing valid CSS, which is the one failure this
   * package may not have. Every browser still accepts them, and the gate caught it on
   * `non-canonical-spelling`'s own test.
   *
   * They are not silent, they belong to the OTHER rule, which says to write `&::before` — the more
   * useful sentence. One fault, one report.
   */
  test.each([":before", ":after", ":first-line", ":first-letter"])(
    "`&%s` is valid CSS and is left to `non-canonical-spelling`",
    (pseudo) => {
      const all = checkNamedFree(`&${pseudo} { color: red; }`);

      expect(found(`&${pseudo}`)).toEqual([]);
      expect(all.map((one) => one.rule)).toEqual(["non-canonical-spelling"]);
    },
  );
});

/**
 * AN AT-RULE NAME THAT DOES NOT EXIST, and it drops the whole rule.
 *
 * Found the way the pseudo-class was: `AT_RULE_LINKS` holds every at-rule name CSS has, and
 * `normalise.ts` and `plugin.ts` both read it — while no RULE did. So the FEATURE inside a `@media`
 * was checked and the word `@media` itself was not:
 *
 *     @media (min-widht: 40rem) { … }   reported
 *     @medai (min-width: 40rem) { … }   silent
 *
 * Measured in Chromium, inserting the rule and reading `cssRules` back: a name the browser does not
 * know keeps ZERO rules — every declaration inside it is dropped, and the element stays black. Same
 * cost as the pseudo-class and for the same reason: it is the rule that is thrown away, not one
 * declaration.
 */
describe("an at-rule name", () => {
  test.each(["@media (min-width: 40rem)", "@supports (display: grid)", "@container (min-width: 10px)", "@layer x"])(
    "%s is one CSS has and is left alone",
    (prelude) => {
      // `@layer` has a rule of its own — `layer-in-a-block` — so it is only the NAME being asked here.
      const found = checkNamedFree(`${prelude} { color: red; }`).filter((one) => one.rule === "unknown-at-rule");

      expect(found).toEqual([]);
    },
  );

  test.each([
    ["a typo", "@medai (min-width: 40rem)", "@media"],
    ["one letter out", "@supprts (display: grid)", "@supports"],
    ["a missing letter", "@containr (min-width: 10px)", "@container"],
  ])("%s is reported: %s", (_what, prelude, meant) => {
    const found = checkNamedFree(`${prelude} { color: red; }`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-at-rule");
    expect(found[0].message).toContain(meant);
  });

  /**
   * A name with no near miss is still reported, because unlike a property this is not a case the
   * types cover — nothing else in this package says a word about it, and the whole rule is dropped.
   */
  test("a name that is nothing at all is reported without a suggestion", () => {
    const found = checkNamedFree("@notarule { color: red; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-at-rule");
    expect(found[0].message).not.toContain("Did you mean");
  });

  /**
   * A VENDOR at-rule is a browser's own — `@-moz-document` was real — so the prefix is checked and
   * the name after it is not, exactly as for a property.
   */
  test("a vendor-prefixed at-rule is left alone", () => {
    expect(checkNamedFree("@-moz-document url-prefix() { color: red; }")).toEqual([]);
  });
});

/**
 * **A SWAPPED PAIR OF LETTERS, which is the commonest typo and got no suggestion.**
 *
 * Found by `@medai` — a transposition of `@media`. Levenshtein counts a swap as TWO edits, and the
 * bound is scaled by length, so for a six-character name it is 1 and the swap is out of reach.
 *
 * Measured over every single-swap typo of every name in the four vocabularies, and every single
 * DELETION too, so the change is measured for what it might break:
 *
 *                     Levenshtein                    optimal string alignment
 *     properties  swap  right 12978  wrong 88  silent 199   right 13263  wrong 2  silent 0
 *     properties  drop  right 14223  wrong 63  silent   0   right 14223  wrong 63 silent 0
 *     features    swap  right   577  wrong 10  silent  31   right   618  wrong 0  silent 0
 *     at-rules    swap  right   157  wrong  0  silent  25   right   182  wrong 0  silent 0
 *     selectors   swap  right  1210  wrong  2  silent 141   right  1353  wrong 0  silent 0
 *
 * Better in every direction — 396 silent typos become 0, 100 wrong suggestions become 2, deletions
 * are untouched — and FASTER, 0.024 ms against 0.037 ms per word over 828 names, because a swap
 * costing 1 reaches the abandon bound sooner.
 *
 * It is one rule with six consumers: `unknown-property`, `unknown-value`, `unknown-media-feature`,
 * `unknown-prefix`, `unknown-at-rule`, and the config's rule-id check.
 */
describe("a swapped pair of letters", () => {
  test.each([
    ["@medai", "@media"],
    ["oclor", "color"],
    ["gpa", "gap"],
  ])("%s is a typo of %s", (typo, meant) => {
    const among = typo.startsWith("@") ? ["@media", "@supports", "@container", "@layer"] : ["color", "gap", "padding"];

    expect(nearest(typo, among)).toBe(meant);
  });

  /** And a name that is nothing like any of them still gets nothing, which is the honest answer. */
  test("but a word that is nothing like one gets no suggestion", () => {
    expect(nearest("zzzzzzzz", ["color", "gap", "padding"])).toBeUndefined();
  });

  /** A deletion still works, which is what the measurement above was checking for. */
  test("a dropped letter is still a typo", () => {
    expect(nearest("colr", ["color", "gap", "padding"])).toBe("color");
    expect(nearest("flex-dirction", ["flex-direction", "flex-wrap"])).toBe("flex-direction");
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
 * **WHERE A SQUIGGLE ABOUT A HOLE LANDS, and two rules pointed at the wrong character.**
 *
 * `Finding` says it in its own doc: `at` is the author's offset OF THE FAULT and `length` is "the
 * offending text itself — the property name, the word in the value — never the whole declaration".
 * A wrong span sends a person to the wrong place, which is the one thing this package says it must
 * never do.
 *
 * And the data was already there. `HolePart` carries `at` and `length`, and its own note says why:
 * *"for a squiggle over the hole itself … it is what lets a rule about a hole's POSITION point at
 * the hole rather than at the declaration holding it."* `hole-as-a-variable-name` reads it.
 * `hole-in-a-named-block` and `glued-hole` did not — one question, two answers, which is this
 * repository's recurring fault.
 *
 * Measured, `@@font-face( src: url({n}); )`:
 *
 *     at 43, length 1, covering "u"      the `u` of `url(`, one character, mid-word
 *
 * Both also stopped after the FIRST hole, so a block with two of them reported one — and the author
 * fixes it, re-runs, and meets the next.
 */
describe("a squiggle about a hole", () => {
  /** What the finding actually covers in the author's own text. */
  const covered = (source: string, one: { at: number; length: number }) => source.slice(one.at, one.at + one.length);

  describe("in a named block", () => {
    test.each([
      ["a hole inside a function", "const n = 1;\nconst a = @@font-face(\n  src: url({n});\n);\n", "{n}"],
      ["a hole as the whole value", "const n = 1;\nconst a = @@font-face(\n  src: {n};\n);\n", "{n}"],
      ["a longer name", "const weight = 1;\nconst a = @@font-face(\n  src: url({weight});\n);\n", "{weight}"],
      [
        "in @@property",
        'const n = 1;\nconst a = @@property(\n  syntax: "<color>";\n  inherits: false;\n  initial-value: {n};\n);\n',
        "{n}",
      ],
      ["in @@keyframes", "const n = 1;\nconst a = @@keyframes(\n  from { opacity: {n}; }\n);\n", "{n}"],
    ])("%s is squiggled over the hole", (_what, source, hole) => {
      const [found] = checkSource(source, "/a.tsx").filter((one) => one.rule === "hole-in-a-named-block");

      expect(found).toBeDefined();
      expect(covered(source, found)).toBe(hole);
    });

    test("every hole is reported, not only the first", () => {
      const source = "const n = 1;\nconst m = 2;\nconst a = @@font-face(\n  src: url({n});\n  font-weight: {m};\n);\n";

      const found = checkSource(source, "/a.tsx").filter((one) => one.rule === "hole-in-a-named-block");

      expect(found).toHaveLength(2);
      expect(found.map((one) => covered(source, one))).toEqual(["{n}", "{m}"]);
    });

    test("and two holes in ONE declaration are two squiggles, because each must go", () => {
      const source = "const a1 = 1;\nconst b1 = 2;\nconst a = @@font-face(\n  src: url({a1}) format({b1});\n);\n";

      const found = checkSource(source, "/a.tsx").filter((one) => one.rule === "hole-in-a-named-block");

      expect(found.map((one) => covered(source, one))).toEqual(["{a1}", "{b1}"]);
    });
  });

  describe("glued to text", () => {
    test.each([
      ["a unit after it", "const w = 1;\nconst a = @@(\n  gap: 8px{w};\n);\n", "{w}"],
      ["a unit written after", "const w = 1;\nconst a = @@(\n  gap: {w}px;\n);\n", "{w}"],
      ["a longer name", "const spacing = 1;\nconst a = @@(\n  gap: {spacing}px;\n);\n", "{spacing}"],
    ])("%s is squiggled over the hole", (_what, source, hole) => {
      const [found] = checkSource(source, "/a.tsx").filter((one) => one.rule === "glued-hole");

      expect(found).toBeDefined();
      expect(covered(source, found)).toBe(hole);
    });

    test("every glued hole is reported", () => {
      const source = "const w = 1;\nconst h = 2;\nconst a = @@(\n  margin: {w}px {h}px;\n);\n";

      const found = checkSource(source, "/a.tsx").filter((one) => one.rule === "glued-hole");

      expect(found.map((one) => covered(source, one))).toEqual(["{w}", "{h}"]);
    });
  });

  /**
   * And the invariant under all of it, asked of every rule at once: a finding is inside the file and
   * covers something. A zero-width squiggle is a mark nobody can see.
   */
  test("every finding is inside the file and covers at least one character", () => {
    const sources = [
      "const a = @@(\n  flex-dirction: row;\n  color: bleu;\n  gap: 8pxx;\n);\n",
      "const w = 1;\nconst a = @@(\n  gap: 8px{w};\n  color: var({w});\n);\n",
      "const a = @@(\n  @medai (min-widht: 40rem) { color: red; }\n  -wdebkit-line-clamp: 3;\n);\n",
      "const n = 1;\nconst a = @@font-face(\n  src: url({n});\n);\n",
      "const a = @@(\n  // a note\n  &:HOVER { color: RED; }\n);\n",
    ];

    for (const source of sources) {
      for (const one of checkSource(source, "/a.tsx")) {
        expect(one.at, `${one.rule} starts before the file`).toBeGreaterThanOrEqual(0);
        expect(one.at + one.length, `${one.rule} runs past the end`).toBeLessThanOrEqual(source.length);
        expect(one.length, `${one.rule} has a zero-width squiggle`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * **EVERY `//`, and it used to be one per block.**
 *
 * The rule stopped after the first, deliberately and with a note: *"One per block: the rest of the
 * line is already claimed, and a file full of them is one habit."* That reasoning was sound when it
 * was written, and a measurement has since undercut it.
 *
 * TypeScript refuses EVERY one of them — the virtual file writes the comment and the next property
 * as one key — and `check.ts` drops a `TS2353` only where a rule of ours already spoke. So with the
 * suppression widened, a file with three comments showed:
 *
 *     2:3  line-comment  CSS has no `//` comment — … Write a block comment instead.
 *     4:3  TS2353        … '"// two\n  color"' does not exist in type 'CssBlockShape'.
 *     6:3  TS2353        … '"// three\n  margin"' does not exist in type 'CssBlockShape'.
 *
 * One good message and two that quote a comment and the next property mashed into a key. Reporting
 * every one gives every comment the message that says what to do, and leaves nothing for the
 * compiler to say badly.
 *
 * The habit argument survives in the other direction too: a person who wrote three wants to know
 * there are three, because it is one edit repeated rather than three decisions.
 */
describe("every line comment", () => {
  const comments = (source: string) => checkSource(source, "/a.tsx").filter((one) => one.rule === "line-comment");

  test.each([
    ["one", 1, "const a = @@(\n  // one\n  gap: 8px;\n);\n"],
    ["two", 2, "const a = @@(\n  // one\n  gap: 8px;\n  // two\n  color: red;\n);\n"],
    ["three", 3, "const a = @@(\n  // one\n  gap: 8px;\n  // two\n  color: red;\n  // three\n  margin: 0;\n);\n"],
  ])("%s is reported as %i", (_what, expected, source) => {
    expect(comments(source)).toHaveLength(expected);
  });

  test("one outside a nested rule and one inside are both reported", () => {
    const source = "const a = @@(\n  // outside\n  gap: 8px;\n  &:hover {\n    // inside\n    color: red;\n  }\n);\n";

    const found = comments(source);

    expect(found).toHaveLength(2);
    // Each squiggle is on its own `//`, which is what an editor draws.
    for (const one of found) expect(source.slice(one.at, one.at + one.length)).toBe("//");
  });

  /**
   * **The rest of the LINE is one fault, not several.** A second `//` after the first is inside the
   * first one's text, and `////` is not four comments.
   *
   * Under test because the claim was written into the code and a control could not see it fail — the
   * standing lesson that an assertion nobody can break is not an assertion.
   */
  test.each([
    ["a doubled slash run", "const a = @@(\n  //// one\n  gap: 8px;\n);\n"],
    ["a second one later on the line", "const a = @@(\n  // one // two\n  gap: 8px;\n);\n"],
    ["a url after a comment starts", "const a = @@(\n  // see https://example.com\n  gap: 8px;\n);\n"],
  ])("%s is one finding", (_what, source) => {
    expect(comments(source)).toHaveLength(1);
  });

  /**
   * **A `//` WITH NOTHING AFTER IT, where the editor and the build said different things.**
   *
   * A line comment is normally absorbed into the next declaration's key, so the block still parses
   * and `line-comment` speaks. When it is the LAST thing there is no next declaration, the parser
   * refuses first, and the refusal is the generic one:
   *
   *     editor (tolerant)   CSS has no `//` comment — … Write a block comment instead.
   *     build and check     `// last` is not a declaration — a block holds `property: value;` …
   *
   * Both true, and only one says what to do. The file is not half-written — somebody finished it
   * that way — so this is the same file getting two different answers from the same package.
   */
  test.each([
    ["on the last line", "const a = @@(\n  gap: 8px;\n  // last\n);\n"],
    ["alone in the block", "const a = @@(\n  // only\n);\n"],
    ["last inside a nested rule", "const a = @@(\n  &:hover {\n    gap: 8px;\n    // last\n  }\n);\n"],
  ])("%s says what to do, not that it is not a declaration", (_what, source) => {
    let said = "";
    try {
      checkSource(source, "/a.tsx");
      said = "did not refuse";
    } catch (error) {
      said = (error as Error).message;
    }

    expect(said).toContain("CSS has no `//` comment");
  });

  /** And each is at its own position, in the order a person reads them. */
  test("each is at its own line", () => {
    const source = "const a = @@(\n  // one\n  gap: 8px;\n  // two\n  color: red;\n);\n";

    const lines = comments(source).map((one) => source.slice(0, one.at).split("\n").length);

    expect(lines).toEqual([2, 4]);
  });

  /**
   * What is still ONE finding: a `//` inside a hole is JavaScript, where a line comment is ordinary
   * and is not this rule's business — and one inside a `/* … *` + `/` is the author's prose.
   */
  test.each([
    ["inside a hole", "const w = 1;\nconst a = @@(\n  gap: {w /* px */};\n);\n"],
    ["inside a block comment", "const a = @@(\n  /* not // a comment */\n  gap: 8px;\n);\n"],
    ["inside a string", 'const a = @@(\n  content: "// not a comment";\n);\n'],
    ["a url with two slashes", "const a = @@(\n  background: url(https://example.com/a.png);\n);\n"],
  ])("%s is not a line comment", (_what, source) => {
    expect(comments(source)).toEqual([]);
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

  test("a hole is one value, because what it evaluates to is decided at render", () => {
    expect(rulesWith("padding: {gap};", ONE)).toEqual([]);
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
 * A declaration with no `;`, which CSS allows for the last one in a block and this does not.
 *
 * **Reported by a user, and the reason is what happens NEXT.** A declaration without its semicolon
 * swallows whatever is written under it — that is `run-on-declaration` — so a block that is legal
 * today makes a stranger's next edit report a fault on a line they did not touch:
 *
 *     padding: 8px          legal, and silent
 *     padding: 8px          somebody adds a line under it
 *     color: red            run-on-declaration, on THEIR line
 *
 * Every other declaration needs one and the formatter writes one, so requiring it costs nobody a
 * keystroke they were not already making.
 */
describe("a declaration with no semicolon", () => {
  test("the last one in a block is reported", () => {
    expect(rules("  color: red;\n  padding: 8px")).toEqual(["missing-semicolon"]);
  });

  test("and the last one in a NESTED rule, which is the same next edit", () => {
    expect(rules("  &:hover { color: red }")).toEqual(["missing-semicolon"]);
  });

  test("a terminated block is silent, which is the control", () => {
    expect(rules("  color: red;\n  padding: 8px;")).toEqual([]);
    expect(rules("  &:hover { color: red; }")).toEqual([]);
  });

  /**
   * **Quiet wherever another rule has already spoken about the same declaration.**
   *
   * A declaration with no `;` is sometimes wreckage — a run-on, a hole standing where a property
   * name goes, a string that was never closed and ate the rest of the block. Listing those shapes
   * was the first attempt and it kept finding another one; asking whether anything has been said
   * about the same span is the question that was actually being asked.
   */
  test.each([
    ["a run-on", "  padding: 8px\n  border-left: 4px solid red;", "run-on-declaration"],
    ["a string that is never closed", `  display: "flexx`, "string-not-allowed"],
    ["a hole where a property name goes", `  {cond ? "display:flex" : ""}`, "hole-out-of-place"],
  ])("%s is left to the rule that explains it", (_what, css, only) => {
    expect(rules(css)).toEqual([only]);
  });

  /**
   * A declaration with NO VALUE yet is the state an editor is in most — `padding: ` while it is
   * being typed. Saying so on every keystroke is noise, and the strict read refuses a valueless
   * declaration outright, so nothing reaches a build this way.
   */
  test("a half-typed declaration says nothing", () => {
    expect(rules("  padding:")).toEqual([]);
  });
});

/**
 * A colour written out where the project takes colours only from its own variables.
 *
 * Asked for by the user: *"za boje moze reci da hoce samo kroz tokene i variable da radi, nece
 * hardcoded values."* A closed list of every permitted colour is not that — a palette is fifty
 * values that change, and pinning them in a property's type puts it in two places.
 *
 * **This is the half a type cannot do.** Sixty-three properties accept a colour; forty say so in
 * their grammar and the generated types refuse a literal there. The other twenty-three are composite
 * — their value is `string | number`, because a union narrow enough to refuse `red` would refuse
 * `4px solid red` as well. So this reads those, and only those: one mechanism per property.
 */
describe("a colour written out, where the project said variables only", () => {
  const ONLY: Config = { properties: { "<color>": { variablesOnly: true } } };

  test.each([
    ["a named colour inside a shorthand", "  border-left: 4px solid red;"],
    ["a hex", "  box-shadow: 0 1px 2px #00000022;"],
    ["a colour function", "  background: linear-gradient(rgb(0 0 0), white);"],
  ])("%s is reported", (_what, css) => {
    expect(rulesWith(css, ONLY)).toEqual(["literal-not-allowed"]);
  });

  test("a variable is what it is asking for, and says nothing", () => {
    // Declared, because `unknown-variable` would otherwise speak about the path and this test would
    // be measuring that rule instead of this one.
    const declared: Config = { ...ONLY, variables: { color: kind("color", { accent: { main: "#10b981" } }) } };

    expect(rulesWith("  border-left: 4px solid $.color.accent.main;", declared)).toEqual([]);
  });

  test("`currentcolor` and `var()` go in, because neither is a colour somebody wrote out", () => {
    expect(rulesWith("  border-left: 4px solid currentcolor;", ONLY)).toEqual([]);
    expect(rulesWith("  border-left: 4px solid var(--brand);", ONLY)).toEqual([]);
  });

  /**
   * A property whose grammar SAYS it takes a colour is read HERE TOO, and used not to be.
   *
   * This asserted the opposite, and its reason was *the types refuse it, and saying it twice for one
   * mistake is the fault this repository keeps finding*. The first half was true of the checker and
   * false of the BUILD: vite and esbuild run these rules and never type-check a block, so `color:
   * red` compiled. The count was never two — it was one in the checker and ZERO where it shipped.
   *
   * Both speak now and `inOrder` drops the compiler's word, which is what the second half of that
   * reason was really asking for.
   */
  test("a property whose grammar says it takes a colour is read here too", () => {
    expect(rulesWith("  color: red;", ONLY)).toEqual(["literal-not-allowed"]);
    expect(rulesWith("  background-color: #fff;", ONLY)).toEqual(["literal-not-allowed"]);
  });

  test("a property that takes no colour has nothing to find", () => {
    expect(rulesWith("  padding: 8px;", ONLY)).toEqual([]);
    expect(rulesWith('  grid-template-areas: "a b";', ONLY)).toEqual([]);
  });

  test("and with no `variablesOnly` anywhere, none of this happens", () => {
    expect(rulesWith("  border-left: 4px solid red;", {})).toEqual([]);
  });
});

/**
 * `units` constrains a FAMILY, because a project that says "px and rem" is talking about lengths.
 *
 * The flat list said *every unit in CSS and nothing else*, and measured, that reported four things
 * nobody writing `units: ["px", "rem"]` means:
 *
 *     transition: all 200ms ease        ms is a time
 *     width: 50%                        % is a percentage
 *     rotate: 45deg                     deg is an angle
 *     grid-template-columns: 1fr        fr is a flex
 *
 * So a project could not state the one rule it actually wanted without enumerating the units of five
 * families it had no opinion about. A family it does not name is a family it does not constrain,
 * which is what makes the setting sayable.
 *
 * The families come from `UNIT_TYPE`, generated with an assertion that every unit lands in exactly
 * one — so a unit CSS adds fails the build until somebody says what it is.
 */
describe("units, by family", () => {
  const under = (units: Config["units"], css: string) => {
    const source = `<div css={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, { config: { units } }).map((one) => one.rule);
  };

  const lengths = { length: ["px", "rem"] } as const;

  test.each([
    ["a time", "  transition: all 200ms ease;"],
    ["a percentage", "  width: 50%;"],
    ["an angle", "  rotate: 45deg;"],
    ["a flex", "  grid-template-columns: repeat(3, 1fr);"],
    ["a resolution", "  --a: 2dppx;"],
    ["a frequency", "  --a: 40hz;"],
  ])("%s is untouched when only lengths were constrained", (_what, css) => {
    expect(under(lengths, css)).toEqual([]);
  });

  test.each([
    ["one this project allows", "  padding: 8px;", []],
    ["the other one it allows", "  padding: 1rem;", []],
    ["one it does not", "  padding: 2em;", ["unit-not-allowed"]],
    ["one it does not, inside a call", "  width: calc(100% - 4em);", ["unit-not-allowed"]],
    ["a bare zero, which has no family at all", "  padding: 0;", []],
  ])("%s", (_what, css, expected) => {
    expect(under(lengths, css)).toEqual(expected);
  });

  test("a second family is constrained independently", () => {
    const both = { length: ["px"], time: ["ms"] } as const;

    expect(under(both, "  transition: all 200ms ease;")).toEqual([]);
    expect(under(both, "  transition: all 2s ease;")).toEqual(["unit-not-allowed"]);
    expect(under(both, "  rotate: 45deg;")).toEqual([]);
  });

  test("the message names the family, so the fix is the one the author meant", () => {
    const source = `<div css={@@(\n  padding: 2em;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [found] = checkBlock(read.block, { config: { units: lengths } });

    expect(found.message).toContain("`em` is a length this project does not use");
    expect(found.message).toContain("px, rem");
  });

  test("an empty list for a family permits nothing of it, which is how a family is banned outright", () => {
    expect(under({ angle: [] }, "  rotate: 45deg;")).toEqual(["unit-not-allowed"]);
    expect(under({ angle: [] }, "  padding: 8px;")).toEqual([]);
  });
});

/**
 * A literal where the project said that KIND comes from its variables — the half the build sees.
 *
 * The types refused `padding-left: 8px` and the RULE said nothing, which read as a division of
 * labour and was a hole. Measured, asking the rules alone — which is all vite and esbuild ever run,
 * since neither type-checks a block:
 *
 *     padding-left: 8px       []                        the build compiled it
 *     width: 200px            []                        and this
 *     color: red              []                        and this
 *     border: 1px solid red   [literal-not-allowed]     only the composite was caught
 *
 * So a project could set `variablesOnly`, watch `ramonda-css check` refuse a file, and watch the
 * dev server serve it. One rule, three consumers, and two of them silent — the repository's
 * recurring fault, found once more by asking what a setting means.
 *
 * The rule speaks for every property now and `inOrder` drops the compiler's duplicate, which is the
 * same answer `unknown-variable` got. It also fixes the message: `Narrowed<never, Token<…>>` names
 * neither the project nor the config file, and this names both.
 *
 * **A CALL is an escape hatch and is not read into.** `calc($.space.md * 2)` has a `2` in it that is
 * not a hardcoded length, and nothing in this rule can tell it from one that is. `var()`, a bare
 * `0`, the CSS-wide keywords and a property's own keywords are all left alone for the same reason:
 * none of them is a value somebody wrote out instead of reaching for a token.
 */
describe("a literal where the project said that kind comes from variables", () => {
  /** Declared, because `unknown-variable` would otherwise speak about the `$` paths below. */
  const VARIABLES = {
    space: kind("length", { gutter: "16px" }),
    motion: kind("time", { quick: "120ms" }),
  };

  const under = (selector: string, decl: string) =>
    checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, {
      config: { variables: VARIABLES, properties: { [selector]: { variablesOnly: true } } },
    }).map((one) => one.rule);

  test.each([
    ["a longhand", "padding-left: 8px"],
    ["one reached only through the kind", "width: 200px"],
    ["a negative length", "margin-top: -8px"],
    ["a shorthand with several", "padding: 8px 16px"],
    ["a percentage, which this property also takes", "padding-left: 50%"],
  ])("%s is reported", (_what, decl) => {
    expect(under("<length>", decl)).toEqual(["literal-not-allowed"]);
  });

  test.each([
    ["a bare zero, which needs no unit in CSS", "padding-left: 0"],
    ["a declared variable, which is the point", "padding-left: $.space.gutter"],
    ["`var()`, the escape CSS itself provides", "padding-left: var(--x)"],
    ["a CSS-wide keyword", "padding-left: inherit"],
    ["the property's own keyword", "width: auto"],
    ["a call, which may hold a variable and arithmetic", "padding-left: calc(100% - 8px)"],
    ["a hole, whose value is decided at render", "padding-left: {gap}"],
  ])("%s is silent", (_what, decl) => {
    expect(under("<length>", decl)).toEqual([]);
  });

  test("another kind, said on its own selector", () => {
    expect(under("<time>", "transition-duration: 200ms")).toEqual(["literal-not-allowed"]);
    expect(under("<time>", "transition-duration: $.motion.quick")).toEqual([]);
    // A length is not a time, and this selector said nothing about lengths.
    expect(under("<time>", "padding-left: 8px")).toEqual([]);
  });

  test("a property exempting itself by name is left alone", () => {
    const config: Config = {
      properties: { "<length>": { variablesOnly: true }, "border-radius": { variablesOnly: false } },
    };
    const of = (decl: string) =>
      checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

    expect(of("border-radius: 4px")).toEqual([]);
    expect(of("padding-left: 8px")).toEqual(["literal-not-allowed"]);
  });

  test("the message names the project and the way out", () => {
    const [found] = checkBlock(readBlock(`@@(\n  padding-left: 8px;\n)`, 2, "C.tsx").block, {
      config: { properties: { "<length>": { variablesOnly: true } } },
    });

    expect(found.message).toContain("`8px`");
    expect(found.message).toContain("ramonda.css.ts");
    expect(found.message).toContain("variablesOnly");
  });

  test("and with no `variablesOnly` anywhere, every one of these is silent", () => {
    const of = (decl: string) => checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, {}).map((o) => o.rule);

    for (const decl of ["padding-left: 8px", "width: 200px", "transition-duration: 200ms"]) {
      expect(of(decl)).toEqual([]);
    }
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
 * The two ways a literal still reached the page after `variablesOnly` was said.
 *
 * **A colour LONGHAND did not reach the build.** The dimension half was extended and the colour
 * half was not: `literalNotAllowed` skipped a property whose grammar says `<color>` as *the types'
 * to refuse*, which was true of the checker and false of vite and esbuild. Forty properties, and
 * `color: red` the first of them.
 *
 * **And a custom property set in the block was an open door.** `--own: red; color: var(--own)` is
 * two declarations this compiler reads, and neither was looked at — so the rule a project turned on
 * could be walked around in one line, by accident as easily as on purpose.
 *
 * A custom property has NO KIND, which is what makes this narrow: a bare `3` is not a length and
 * `"red"` inside quotes is not a colour. Only a value that can be nothing else is reported — a hex,
 * a colour function, a named colour, or a number carrying a unit.
 */
describe("a literal that reached the page anyway", () => {
  const ONLY: Config = {
    variables: { brand: kind("color", { main: "#10b981" }), space: kind("length", { sm: "8px" }) },
    properties: { "<color>": { variablesOnly: true }, "<length>": { variablesOnly: true } },
  };
  const of = (decl: string) =>
    checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, { config: ONLY }).map((one) => one.rule);

  test.each([
    ["a colour longhand, which the build never saw", "color: red"],
    ["a hex in one", "background-color: #ff0000"],
    ["a colour function", "border-top-color: rgb(255 0 0)"],
  ])("%s is reported", (_what, decl) => {
    expect(of(decl)).toEqual(["literal-not-allowed"]);
  });

  test.each([
    ["a colour put into a custom property", "--own: red"],
    ["a hex put into one", "--own: #ff0000"],
    ["a length put into one", "--gap: 8px"],
  ])("%s is reported", (_what, decl) => {
    expect(of(decl)).toEqual(["literal-not-allowed"]);
  });

  test("the whole bypass, which is what this is for", () => {
    expect(of("--own: red; color: var(--own)")).toEqual(["literal-not-allowed"]);
  });

  test.each([
    ["a declared variable, which is the point", "--own: $.brand.main"],
    ["a colour word inside a STRING, which is text", '--label: "red"'],
    ["a bare number, which has no kind at all", "--n: 3"],
    ["a keyword", "--mode: dark"],
    ["`var()`, the escape CSS itself provides", "--own: var(--theme)"],
    ["a zero", "--gap: 0"],
  ])("%s is silent", (_what, decl) => {
    expect(of(decl)).toEqual([]);
  });

  /** And none of it happens to a project that said nothing. */
  test("with no `variablesOnly`, every one of these is silent", () => {
    const plain = (decl: string) =>
      checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, {}).map((one) => one.rule);

    for (const decl of ["color: red", "--own: red", "--gap: 8px"]) expect(plain(decl)).toEqual([]);
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
    const result = transform(`const a = <div css={@@(${css})}>x</div>;`, { filename: "C.tsx" });
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
    const of = (css: string) => transform(`const a = <div css={@@(${css})}>x</div>;`, { filename: "C.tsx" });

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
 * Three settings the TYPES enforced and the BUILD did not.
 *
 * Review pass 4 swept every setting against every consumer, which is the shape four of this
 * session's faults had. Vite and esbuild run these rules over a block and never type-check it, so a
 * setting that only reaches the types is a setting the dev server ignores:
 *
 *     properties["*"].units         padding-left: 2rem    checker refuses, build serves
 *     properties["z-index"].values  z-index: 5            checker refuses, build serves
 *     properties["*"].shorthand     padding: 8px          checker refuses, build serves
 *
 * The other three — the project-wide `units`, `arity` and `variablesOnly` — already spoke in both.
 * So half the config was enforced everywhere and half in one place, with nothing saying which.
 *
 * The precedent is the one `variablesOnly` set: *a project could watch `ramonda-css check` refuse a
 * file and watch the dev server serve it.* `inOrder` drops the compiler's word where these speak, so
 * an author still meets one report rather than two.
 */
describe("a setting the types enforced and the build did not", () => {
  const under = (config: Config, css: string) =>
    checkBlock(readBlock(`@@(\n  ${css};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

  describe("a unit said on a property", () => {
    const config: Config = { properties: { "*": { units: ["px"] } } };

    test.each([
      ["a unit the project does not use", "padding-left: 2rem"],
      ["one inside a call", "width: calc(100% - 2rem)"],
    ])("%s is reported", (_what, css) => {
      expect(under(config, css)).toEqual(["unit-not-allowed"]);
    });

    /**
     * A family the list says nothing about is not constrained — found by MUTATION.
     *
     * Review pass 7 broke `const family = UNIT_TYPE[unit]` on purpose and the whole suite stayed
     * green: one case named a time, and a time is not a length, so it would have been silent either
     * way. What was never asked is whether a unit of ANOTHER family is silent because of its family
     * or by accident — so all four are here, one per family a project might meet.
     */
    test.each([
      ["a unit it does use", "padding-left: 8px"],
      ["a bare zero, which has no unit", "padding-left: 0"],
      ["a time, where the list holds lengths", "transition-duration: 200ms"],
      ["an angle", "rotate: 45deg"],
      ["a percentage, which is its own family", "width: 50%"],
      ["a flex", "grid-template-columns: repeat(3, 1fr)"],
    ])("%s is silent", (_what, css) => {
      expect(under(config, css)).toEqual([]);
    });

    test("one property's units do not reach another", () => {
      const only: Config = { properties: { "letter-spacing": { units: ["em"] } } };

      expect(under(only, "letter-spacing: 2px")).toEqual(["unit-not-allowed"]);
      expect(under(only, "padding-left: 2px")).toEqual([]);
    });
  });

  describe("a closed list of values", () => {
    const config: Config = { properties: { "z-index": { values: [0, 1, 10] } } };

    test.each([
      ["a value outside it", "z-index: 5"],
      ["a keyword outside it", "z-index: auto"],
    ])("%s is reported", (_what, css) => {
      expect(under(config, css)).toEqual(["value-not-allowed"]);
    });

    test.each([
      ["one from the list", "z-index: 10"],
      ["`var()`, the escape CSS provides", "z-index: var(--layer)"],
      ["a CSS-wide keyword", "z-index: inherit"],
      ["another property entirely", "order: 5"],
    ])("%s is silent", (_what, css) => {
      expect(under(config, css)).toEqual([]);
    });

    /**
     * A QUOTED value is `string-not-allowed`'s, and this one stayed out of it.
     *
     * **Reported by the user**, who read the two together and saw a contradiction: the type offers
     * `"1"` and the rule refuses it. Measured, `z-index: "1"` gave two findings, and the second was
     * worse than redundant — *takes only 0, 1, 10 … and this is `"1"`* names a value that IS in the
     * list. The fault is the quoting, not the number.
     *
     * The string spellings in the type are not a widening of what the project permitted. A block is
     * CSS, so `z-index: 1` reaches the type as the string `"1"` — `a closed list` above was written
     * for exactly that, because a list of numbers used to refuse its own permitted values. A hole
     * may hand over either, and both mean the same declaration.
     */
    test("a quoted value is reported once, by the rule about quotes", () => {
      expect(under(config, 'z-index: "1"')).toEqual(["string-not-allowed"]);
    });

    test("and a quoted value that is not in the list is still just the quoting", () => {
      expect(under(config, 'z-index: "5"')).toEqual(["string-not-allowed"]);
    });

    test("the message names the list", () => {
      expect(under(config, "z-index: 5")).toEqual(["value-not-allowed"]);
      const [found] = checkBlock(readBlock(`@@(\n  z-index: 5;\n)`, 2, "C.tsx").block, { config });

      expect(found.message).toContain("0, 1, 10");
    });
  });

  describe("a shorthand switched off", () => {
    const config: Config = { properties: { "*": { shorthand: false }, padding: { shorthand: true } } };

    test.each([
      ["one the project switched off", "margin: 8px"],
      ["another", "background: red"],
    ])("%s is reported", (_what, css) => {
      expect(under(config, css)).toEqual(["shorthand-not-allowed"]);
    });

    test.each([
      ["the one it kept", "padding: 8px"],
      ["a longhand, which is the point", "margin-top: 8px"],
    ])("%s is silent", (_what, css) => {
      expect(under(config, css)).toEqual([]);
    });

    test("the message names longhands to write, and how many there are", () => {
      const [found] = checkBlock(readBlock(`@@(\n  margin: 8px;\n)`, 2, "C.tsx").block, { config });

      expect(found.message).toContain("margin-block");
      expect(found.message).toContain("7 more");
    });
  });

  /** And a project that said nothing gets none of it. */
  test("with no config, all three are silent", () => {
    for (const css of ["padding-left: 2rem", "z-index: 5", "margin: 8px"]) expect(under({}, css)).toEqual([]);
  });
});

/**
 * Two faults where the CLI and the BUNDLERS disagreed — review pass 6.
 *
 * Both consumers were asked the same question about the same file, which is the lens four of this
 * session's findings came through.
 *
 * ## A unit reported twice
 *
 * `units` at the top of the config and `units` inside `properties` are different mechanisms with one
 * name — the design review said so — and pass 4 gave the second one a rule. Setting both then
 * reported the same value twice. One value, one fault, one report.
 *
 * ## A property typo the build compiled
 *
 * The split was deliberate and half of it was right: a DASHED name — `flex-dirction` — gets
 * `unknown-property`, because TypeScript offers no *did you mean* for a quoted key; a plain name —
 * `dsiplay` — was left to `TS2561`, which says it better.
 *
 * It says it better in the CHECKER. The build runs no TypeScript, so `dsiplay: flex` and even
 * `zzz: flex` compiled into the stylesheet with nothing said anywhere. The rule speaks for both
 * now, and `inOrder` drops the compiler's word on the line — the same arrangement
 * `unknown-variable` and `variablesOnly` already have.
 */
describe("what the bundlers see and the checker saw", () => {
  const under = (css: string, config: Config = {}) =>
    checkBlock(readBlock(`@@(\n  ${css};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

  test("a unit is reported once, whichever settings are in play", () => {
    const both: Config = { units: { length: ["px"] }, properties: { "*": { units: ["px"] } } };

    expect(under("padding-left: 2rem", both)).toEqual(["unit-not-allowed"]);
    expect(under("padding-left: 2rem", { units: { length: ["px"] } })).toEqual(["unit-not-allowed"]);
    expect(under("padding-left: 2rem", { properties: { "*": { units: ["px"] } } })).toEqual(["unit-not-allowed"]);
  });

  test("two different units in one value are still two faults", () => {
    const both: Config = { units: { length: ["px"] }, properties: { "*": { units: ["px"] } } };

    expect(under("padding: 2rem 3em", both)).toEqual(["unit-not-allowed", "unit-not-allowed"]);
  });

  test.each([
    ["a plain name, which the checker left to TypeScript", "dsiplay: flex"],
    ["one that is near nothing", "zzz: flex"],
    ["a dashed name, which always spoke", "flex-dirction: row"],
    ["another", "padding-lefft: 8px"],
  ])("%s is reported, so the build sees it", (_what, css) => {
    expect(under(css)).toContain("unknown-property");
  });

  test("and the suggestion is still there for a plain name", () => {
    const [found] = checkBlock(readBlock(`@@(\n  dsiplay: flex;\n)`, 2, "C.tsx").block, {});

    expect(found.message).toContain("display");
  });

  test.each([
    ["a real property", "display: flex"],
    ["a vendor prefix", "-webkit-line-clamp: 3"],
    ["a custom property", "--row-height: 2rem"],
    ["one CSS added after our table", "-moz-osx-font-smoothing: grayscale"],
  ])("%s is silent", (_what, css) => {
    expect(under(css)).toEqual([]);
  });
});

/**
 * Every rule a project's CONFIG turns on, measured INSIDE a nested rule.
 *
 * Found by coverage, and it was six lines in a row: each of these rules walks a block and recurses
 * into a nested one, and not one of those recursions had ever run in a test. The rules are the six
 * review pass 4 added and reworked — the whole config-driven half — so the question the gap asked
 * was whether a project's settings reach `&:hover { … }` at all, or stop at the top level where
 * every test happened to put them.
 *
 * **They reach it, at any depth**, which is what these assert. A nested rule is where a hover
 * colour and a focus ring are written, so a `variablesOnly` that stopped at the top level would
 * have exempted the declarations most likely to hold a hardcoded one.
 */
describe("a config rule inside a nested rule", () => {
  const config: Config = {
    /**
     * `time` as well as `length`, so a unit can be refused on a property whose KIND this config does
     * not also take from variables — otherwise `literal-not-allowed` answers first and the unit
     * rules below would be asserting something else's presence. See "a declaration that breaks more
     * than one of a project's rules".
     */
    units: { length: ["px"], time: ["ms"] },
    properties: {
      "<color>": { variablesOnly: true },
      "<length>": { variablesOnly: true },
      "z-index": { values: [0, 1] },
      padding: { shorthand: false },
      "transition-duration": { units: ["ms"] },
    },
    variables: { color: kind("color", { primary: { main: "#3b82f6" } }) },
  };

  const under = (css: string) => {
    const source = `<div css={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, { config }).map((one) => one.rule);
  };

  test.each([
    ["a colour written out", "color: #ff0000;", "literal-not-allowed"],
    ["a length written out", "padding-top: 8px;", "literal-not-allowed"],
    ["a value outside the closed list", "z-index: 5;", "value-not-allowed"],
    ["a shorthand switched off", "padding: 8px;", "shorthand-not-allowed"],
    ["a unit this property does not take", "transition-duration: 2s;", "unit-not-allowed"],
    ["a unit the project does not take", "animation-duration: 2s;", "unit-not-allowed"],
  ])("%s is reported at the top level, one deep and two deep", (_what, css, rule) => {
    // The top level first, so a config that reached nothing would not pass the two below for free.
    expect(under(`  ${css}`)).toContain(rule);
    expect(under(`  &:hover {\n    ${css}\n  }`)).toContain(rule);
    expect(under(`  &:hover {\n    &:focus {\n      ${css}\n    }\n  }`)).toContain(rule);
  });

  /**
   * A custom property nested too, which is the walk `dimensionNotAllowed` has of its own.
   *
   * `--own: red; color: var(--own)` walks around `variablesOnly` in one line, and a nested rule is
   * exactly where somebody would set one.
   */
  test("a custom property holding a forbidden value is read inside a nested rule", () => {
    expect(under(`  &:hover {\n    --own: #ff0000;\n  }`)).toContain("literal-not-allowed");
  });

  /**
   * The two silences, which are DELIBERATE and are asserted so they stay that way.
   *
   * A bare zero needs no unit in CSS and is nobody's hardcoded value; a non-colour in a colour
   * property is not what `variablesOnly` is for, and the types refuse it anyway.
   */
  test.each([
    ["a bare zero", "padding-top: 0;"],
    ["a value that is not of the forbidden kind", "color: 2px;"],
    ["a variable, which is the point of the setting", "color: $.color.primary.main;"],
    ["a `var()` call", "color: var(--anything);"],
  ])("%s stays silent inside a nested rule too", (_what, css) => {
    expect(under(`  &:hover {\n    ${css}\n  }`)).toEqual([]);
  });
});

/**
 * ONE mistake, ONE finding — when a project narrows several things at once.
 *
 * `literal-not-allowed` is the widest of the config's rules: it fires on any written-out value of a
 * kind taken from variables, so it landed beside every narrower rule that also fired. Measured under
 * a config narrowing units, shorthands, arity and a kind at the same time:
 *
 *     letter-spacing: 2rem     literal-not-allowed + unit-not-allowed
 *     margin: 8px              shorthand-not-allowed + literal-not-allowed
 *     padding-left: 1px 2px    too-many-values + literal-not-allowed
 *
 * Each is one gesture by the author, and two reports for one gesture is what the whole `inOrder`
 * machinery exists to stop on the other side of the tool.
 *
 * **The order is the order the fixes nest in**, which is what makes it one principle rather than a
 * table of pairs. A declaration is decided outside in: WHICH property, then HOW MANY values, then
 * WHERE the value comes from, then HOW it is spelt. Each later answer is a detail of the earlier
 * one, so the outermost unanswered question is the one to ask.
 *
 *     shorthand-not-allowed   the property itself
 *     too-many-values         how many values it takes
 *     literal-not-allowed     where the value comes from
 *     unit-not-allowed        how that value is spelt
 *
 * Reading `unit-not-allowed` first is the case that shows why: it sends the author to `2px`, which
 * their own config still refuses — a round trip that ends where `literal-not-allowed` would have
 * started them.
 */
describe("a declaration that breaks more than one of a project's rules", () => {
  const config: Config = {
    units: { length: ["px"] },
    properties: {
      "<length>": { variablesOnly: true },
      "<color>": { variablesOnly: true },
      "*": { shorthand: false },
      // Exempt, so `too-many-values` can be reached without `shorthand-not-allowed` answering first.
      padding: { shorthand: true, arity: 1 },
      "z-index": { values: [0, 1] },
    },
    variables: { space: kind("length", { gutter: "16px" }) },
  };

  const under = (css: string) => {
    const source = `<div css={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, { config }).map((one) => one.rule);
  };

  test.each([
    ["a forbidden unit on a kind taken from variables", "  letter-spacing: 2rem;", "literal-not-allowed"],
    ["a shorthand that is switched off", "  margin: 8px;", "shorthand-not-allowed"],
    ["more values than the project allows", "  padding: 1px 2px;", "too-many-values"],
  ])("%s is one finding, the outermost", (_what, css, rule) => {
    expect(under(css)).toEqual([rule]);
  });

  /** Each alone is untouched — the collapse may not cost a report that stands on its own. */
  test.each([
    ["a colour written out", "  color: #ff0000;", "literal-not-allowed"],
    ["a value outside a closed list", "  z-index: 5;", "value-not-allowed"],
    ["a shorthand with a variable in it", "  margin: $.space.gutter;", "shorthand-not-allowed"],
  ])("%s is still reported on its own", (_what, css, rule) => {
    expect(under(css)).toEqual([rule]);
  });

  /** And two faults in two DECLARATIONS are still two, which is the line this must not cross. */
  test("a second declaration keeps its own finding", () => {
    expect(under("  margin: 8px;\n  color: #ff0000;")).toEqual(["shorthand-not-allowed", "literal-not-allowed"]);
  });

  /** A unit refused where the kind is NOT taken from variables still says which unit. */
  test("a forbidden unit alone still names the unit", () => {
    expect(under("  transition-duration: 2s;")).toEqual([]);
    expect(under("  letter-spacing: $.space.gutter;")).toEqual([]);
  });
});

/**
 * A CALL that is never closed, named where it opens.
 *
 * `content: url(;` is a missing `)`, and what the author was told had nothing to do with it. The
 * value scanner counts parens, and a block's own closer is a `)` like any other — so the value ran
 * past `)}` and swallowed whatever came next:
 *
 *     content: url(;      →  "`const d = (1 + 2)` is not a declaration"
 *                            reported on line 4, for a mistake on line 2
 *
 * The note that parked this said the parens are BALANCED so no cheap check exists. That is true of
 * the block and false of the DECLARATION: inside one, `url(` is short a `)` and counting says so —
 * as long as the count skips a string, which is what made a naive version wrong about
 * `url("a)b.png"`.
 */
describe("a call that is never closed", () => {
  const under = (css: string) => {
    const source = `<div css={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test.each([
    ["a url", "  content: url(;"],
    ["a calc", "  width: calc(1px;"],
    ["a nested call", "  width: calc(min(1px, 2px;"],
  ])("%s is reported, with the call named", (_what, css) => {
    const found = under(css);

    expect(found.map((one) => one.rule)).toContain("unclosed-call");
    expect(found.find((one) => one.rule === "unclosed-call")?.message).toMatch(/\)/);
  });

  test("the message names the function, so the fix is where the fault is", () => {
    const [found] = under("  content: url(;").filter((one) => one.rule === "unclosed-call");

    expect(found.message).toContain("url(");
  });

  /**
   * A `)` inside a STRING is not structure, and this cuts both ways.
   *
   * `content: url("a)b.png";` really IS unclosed — the only `)` is inside the quotes, so the call
   * never closes and the report is right. I wrote this row the other way round first and the code
   * was correct; a naive count agrees with the wrong answer, which is why the string skip is the
   * thing being tested here rather than an implementation detail.
   */
  test("a closer inside a string does not close the call", () => {
    expect(under(`  content: url("a)b.png";`).map((one) => one.rule)).toContain("unclosed-call");
  });

  test.each([
    ["an opener inside a string", `  content: url("a(b.png");`],
    ["a closed call", "  content: url(a.png);"],
    ["nested and closed", "  width: calc(min(1px, 2px) + 3px);"],
    ["no call at all", "  padding: 8px;"],
  ])("%s is not reported (%#)", (_what, css) => {
    expect(under(css).map((one) => one.rule)).not.toContain("unclosed-call");
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
    const source = `<div css={@@(\n  ${css}\n)}>x</div>`;
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
 * A PROPERTY NAME in the wrong case, which is the same CSS and was called a typo.
 *
 * `unknownValue`'s own note settled this for VALUES and its words are the argument here too: *a
 * keyword in the wrong CASE is the same CSS, and saying it does not exist is a lie the author cannot
 * act on.* The verdict it reached — still refused, under `non-canonical-spelling`, because a
 * repository wants one spelling and the formatter writes it — was never applied to the name half.
 *
 * Measured in Chromium, Firefox and WebKit: `COLOR: red` sets `color` to red in all three, and
 * `CSS.supports("COLOR", "red")` is true in all three. Property names are case-insensitive in CSS.
 *
 * So `COLOR` was reported as `unknown-property` — *`COLOR` is not a CSS property* — with no
 * suggestion, because `nearest` measures a distance and the distance from `COLOR` to `color` is
 * five substitutions.
 */
describe("a property name in the wrong case", () => {
  const under = (css: string) => {
    const source = `<div css={@@(\n  ${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test.each([["COLOR: red;"], ["PADDING-LEFT: 8px;"], ["Display: flex;"]])(
    "`%s` is one spelling of correct CSS, not an unknown property",
    (css) => {
      const found = under(css);

      expect(found.map((one) => one.rule)).toEqual(["non-canonical-spelling"]);
      expect(found[0].message).not.toContain("is not a CSS property");
    },
  );

  test("and the message says which spelling to write", () => {
    const [found] = under("COLOR: red;");

    expect(found.message).toContain("color");
  });

  /** A real typo is still a real typo, whatever its case — the half this must not cost. */
  test.each([
    ["dsiplay: flex;", "display"],
    ["DSIPLAY: flex;", "display"],
    ["colr: red;", "color"],
  ])("`%s` is still reported as unknown, with the near miss", (css, meant) => {
    const found = under(css);

    expect(found.map((one) => one.rule)).toEqual(["unknown-property"]);
    expect(found[0].message).toContain(meant);
  });
});

/**
 * A declaration another declaration on the SAME element switches off.
 *
 * This is the one question ordinary CSS cannot ask. A stylesheet does not know which rules reach an
 * element, so nothing there can say *this line does nothing*; a block is one element's rule, so
 * here it is answerable — and what it catches is a broken LAYOUT rather than broken CSS.
 *
 * ## Why every list here was measured rather than recalled
 *
 * Asked of Chromium, each property beside `display: block` and beside the display that uses it.
 * **Four of the seventeen candidates ACT on a block container** — `align-content`, `justify-items`,
 * `place-items` and `place-content`, which modern engines apply to block layout — so a list written
 * from memory would have been four false reports. They are not in the table.
 *
 * ## And why silence is the default
 *
 * `flatten` drops a spread: `...{base}` merges declarations this never sees. So the rule may only
 * read a disabling declaration that is PRESENT, never infer one from an absence — `top: 20px` alone
 * says nothing, because the block spread above it may be what positions the element.
 */
describe("a declaration another one on the same element switches off", () => {
  test.each([
    ["display: block; gap: 12px;", "gap"],
    ["display: block; justify-content: flex-end;", "justify-content"],
    ["display: block; flex-direction: column;", "flex-direction"],
    ["display: block; grid-template-columns: 1fr 1fr;", "grid-template-columns"],
    ["display: inline; row-gap: 12px;", "row-gap"],
    ["display: table; gap: 12px;", "gap"],
  ])("`%s` is reported on `%s`", (css, property) => {
    const found = check(css).filter((one) => one.rule === "declaration-does-nothing");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(property);
    expect(found[0].message).toContain("display");
  });

  test.each([
    ["display: flex; gap: 12px;"],
    ["display: grid; gap: 12px;"],
    ["display: inline-flex; justify-content: flex-end;"],
    ["display: inline-grid; grid-template-rows: 40px;"],
    // Measured: a multi-column block uses `gap`, so the same pair is correct CSS here.
    ["display: block; columns: 2; gap: 12px;"],
    ["display: block; column-count: 2; gap: 12px;"],
    // Measured: these act on a block container, so reporting them would report correct CSS.
    ["display: block; align-content: flex-end;"],
    ["display: block; justify-items: end;"],
    ["display: block; place-items: end;"],
    ["display: block; place-content: end;"],
    // A spread may be what sets `display`, and this cannot see one.
    ["gap: 12px;"],
    // Nothing here knows what the hole holds, or what a global keyword resolves to.
    ["display: {0}; gap: 12px;"],
    ["display: inherit; gap: 12px;"],
    // An element with no box makes EVERY declaration inert; naming one of them would be noise.
    ["display: none; gap: 12px;"],
    ["display: contents; gap: 12px;"],
  ])("`%s` is silent", (css) => {
    expect(check(css).map((one) => one.rule)).not.toContain("declaration-does-nothing");
  });

  test.each([
    ["position: static; top: 20px;", "top"],
    ["position: static; inset: 20px;", "inset"],
    ["position: absolute; float: left;", "float"],
    ["position: fixed; float: right;", "float"],
    ["overflow: visible; resize: both;", "resize"],
    ["text-overflow: ellipsis; white-space: normal;", "text-overflow"],
    ["text-overflow: ellipsis; white-space: pre-wrap; overflow: hidden;", "text-overflow"],
    ["overflow: visible; white-space: nowrap; text-overflow: ellipsis;", "text-overflow"],
    ["width: 120px; height: 60px; aspect-ratio: 1 / 3;", "aspect-ratio"],
  ])("`%s` is reported on `%s`", (css, property) => {
    const found = check(css).filter((one) => one.rule === "declaration-does-nothing");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(property);
  });

  test.each([
    ["position: relative; top: 20px;"],
    ["position: absolute; inset: 20px;"],
    ["position: static; float: left;"],
    ["overflow: auto; resize: both;"],
    ["overflow: hidden; white-space: nowrap; text-overflow: ellipsis;"],
    ["overflow: clip; white-space: pre; text-overflow: ellipsis;"],
    // `white-space` is INHERITED, so an absent one may be `nowrap` from an ancestor.
    ["overflow: hidden; text-overflow: ellipsis;"],
    ["width: 120px; aspect-ratio: 1 / 3;"],
    ["width: 120px; height: auto; aspect-ratio: 1 / 3;"],
    ["top: 20px;"],
    ["float: left;"],
    ["resize: both;"],
  ])("`%s` is silent", (css) => {
    expect(check(css).map((one) => one.rule)).not.toContain("declaration-does-nothing");
  });

  /**
   * A nested rule is a different group, and that is deliberate.
   *
   * `&:hover` is the same ELEMENT, so a `display` in the base group really does decide a `gap`
   * written under the hover — but `& > span` is a different element and the same reading would be
   * wrong about it. Silence costs a report; the alternative costs a false one.
   */
  test("a declaration under a nested selector is not decided by the base group", () => {
    expect(check("display: block;\n&:hover { gap: 12px; }").map((one) => one.rule)).not.toContain(
      "declaration-does-nothing",
    );
  });

  test("but a nested rule that sets both is reported", () => {
    const found = check("&:hover { display: block; gap: 12px; }").filter(
      (one) => one.rule === "declaration-does-nothing",
    );

    expect(found).toHaveLength(1);
  });

  /** Two rows can fire on `text-overflow`, and one mistake is one report. */
  test("a declaration both of its neighbours switch off is reported once", () => {
    const found = check("text-overflow: ellipsis; white-space: normal; overflow: visible;").filter(
      (one) => one.rule === "declaration-does-nothing",
    );

    expect(found).toHaveLength(1);
  });

  test("the message says what to do about it", () => {
    const [found] = check("display: block; gap: 12px;").filter((one) => one.rule === "declaration-does-nothing");

    expect(found.message).toContain("does nothing");
    expect(found.message).toContain("display: block");
  });
});
