import { describe, expect, test } from "vitest";
import { ABBREVIATIONS, KEYWORDS, PROPERTIES, SHORTHANDS } from "../compiler/keywords.generated";
import { readBlock } from "../compiler/read";
import { namedSites, syntaxesIn } from "../compiler/references";
import { type Finding, checkBlock, checkText } from "../compiler/rules";
import { findBlocks } from "../compiler/scan";

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
  const source = `<div css=@@(\n${css}\n)>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  // Both halves, the way the real callers ask: the parse for what a declaration says, the text for
  // what the parser has no name for.
  return [...checkText(source, site.open, read.end), ...checkBlock(read.block)].sort((a, b) => a.at - b.at);
}

const rules = (css: string) => check(css).map((finding) => finding.rule);
const messages = (css: string) => check(css).map((finding) => finding.message);

describe("a property name the types could not suggest", () => {
  /**
   * The types report a dashed name as `TS2353` with no suggestion, because a QUOTED object key gets
   * none — measured. A bare one gets `TS2561` and TypeScript's own *did you mean*, so it is not
   * repeated here: one fault, one report.
   */
  test("a dashed near miss is named, with what was meant", () => {
    const [only, ...rest] = check("  flex-dirction: row;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("flex-dirction");
    expect(only.message).toContain("flex-direction");
  });

  test("a bare name is left to the types, which say it better", () => {
    expect(rules("  dsiplay: flex;")).toEqual([]);
  });

  test("a dashed name with no near miss at all is still not this rule's to report", () => {
    // Nothing to suggest means nothing to add to what the types already said.
    expect(rules("  zzz-qqq-www: 1px;")).toEqual([]);
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
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test.each([
    ["a string where the grammar allows none", `  display: "flexx";`],
    ["a function with a string in it", `  transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1);`],
    ["a nested function", "  transform: translate(calc(100% - 4px), 0);"],
    ["an escaped quote inside a string", `  display: "a\\"b";`],
    ["a string that is never closed", `  display: "flexx`],
    ["a string inside a function", `  display: nonsense("flexx");`],
  ])("%s is silent", (_what, css) => {
    // Each of these is a shape the word reader has to STEP OVER rather than judge: a string's
    // contents and a function's arguments are their own grammars.
    expect(rules(css)).toEqual([]);
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
    ["a whole declaration", `  {cond ? "display:flex" : ""}`],
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
    const source = `<div css=@@(\n  display: flexx;\n  flex-dirction: row;\n  overflow: hiddn;\n)>x</div>`;
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
    const source = `<div css=@@(\n  display: flex;\n  flex-dirction: row;\n)>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    const [only] = checkBlock(read.block);
    expect(only.at).toBe(source.indexOf("flex-dirction"));
  });

  test("and a value fault points at the word, not at the declaration", () => {
    const source = `<div css=@@(\n  border-left: 4px sollid red;\n)>x</div>`;
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
   * **The merge built on this table is associative**, which is what makes a nested `@@if` mean the
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

  test("`@supports` is the same, because a condition adds no specificity", () => {
    expect(checkNamedFree("@supports (display: grid) { padding: 40px; }\npadding: 8px;")[0]?.rule).toBe(
      "override-out-of-order",
    );
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
 * A `var()` reading a name that is nearly one the same block SETS.
 *
 * **The fault the whole `@ramonda/css` variable discussion started from.** The user's own words:
 * *"background: var(--ackcent); ovo me brine"* — and measured, three ways, nothing reported it:
 *
 * | written | reported before this |
 * |---|---|
 * | `--accent: #10b981; background: var(--ackcent);` | nothing |
 * | `--accent: {{accent}}; background: var(--ackcent);` | nothing |
 * | `background: var(--nothing-sets-this);` | nothing |
 *
 * ## Why only a NEAR MISS, and why the third row must stay silent
 *
 * A custom property inherits, so `var(--brand)` reading something a stylesheet or an ancestor set is
 * ordinary, correct CSS — and a block cannot see either. **A rule that spoke about every unknown name
 * would report correct CSS**, which is how a checker earns being switched off. So it speaks only when
 * the block itself sets a name this one is within an edit or two of: then the author demonstrably
 * meant that name, and the evidence is in the same few lines.
 *
 * This is the deny-list-not-allow-list discipline track Y chose for at-rules, and the same
 * `nearest()` bound the unit rule uses — both for the same reason, that being quiet about something
 * new costs a missed report while being loud about it costs correct code.
 *
 * A name that matches EXACTLY is the working case and says nothing, at any nesting: the set may be
 * at the top of the block and the read inside `&:hover`, which is the normal shape.
 */
describe("a variable read by a name the block does not set", () => {
  const of = (source: string): Finding[] => checkBlock(readBlock(source, 2, "C.tsx").block);
  const rules = (source: string) => of(source).map((one) => one.rule);

  test("a near miss on a name the block sets", () => {
    const findings = of(`@@(\n  --accent: #10b981;\n  background: var(--ackcent);\n)`);

    expect(findings.map((one) => one.rule)).toEqual(["variable-read-by-another-name"]);
    expect(findings[0].message).toContain("--accent");
  });

  test("the squiggle covers the name that was read, not the declaration", () => {
    const source = `@@(\n  --accent: #10b981;\n  background: var(--ackcent);\n)`;
    const [finding] = of(source);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("--ackcent");
  });

  test("a name set by a hole is still a name the block sets", () => {
    expect(rules(`@@(\n  --accent: {accent};\n  background: var(--ackcent);\n)`)).toEqual([
      "variable-read-by-another-name",
    ]);
  });

  test("set at the top and read inside a nested rule", () => {
    expect(rules(`@@(\n  --accent: red;\n  &:hover {\n    color: var(--acent);\n  }\n)`)).toEqual([
      "variable-read-by-another-name",
    ]);
  });

  test("and the other way round, because a block has one scope for these", () => {
    expect(rules(`@@(\n  &:hover {\n    --accent: red;\n  }\n  color: var(--acent);\n)`)).toEqual([
      "variable-read-by-another-name",
    ]);
  });

  test("a fallback's own `var()` is read too", () => {
    expect(rules(`@@(\n  --accent: red;\n  color: var(--brand, var(--ackcent));\n)`)).toEqual([
      "variable-read-by-another-name",
    ]);
  });

  describe("what it must not report, because the CSS is correct", () => {
    test("the exact name, which is the working case", () => {
      expect(rules(`@@(\n  --accent: red;\n  background: var(--accent);\n)`)).toEqual([]);
    });

    test("the exact name across a nesting", () => {
      expect(rules(`@@(\n  --accent: red;\n  &:hover {\n    color: var(--accent);\n  }\n)`)).toEqual([]);
    });

    /** The third row of the table above, and the reason the rule is a near miss and not a lookup. */
    test("a name nothing here sets — it inherits, and this block cannot see where from", () => {
      expect(rules(`@@(\n  background: var(--nothing-sets-this);\n)`)).toEqual([]);
    });

    test("nor one that is merely unlike anything set", () => {
      expect(rules(`@@(\n  --accent: red;\n  background: var(--page-gutter);\n)`)).toEqual([]);
    });

    test("a block that sets nothing reports nothing, whatever it reads", () => {
      expect(rules(`@@(\n  color: var(--a);\n  background: var(--b);\n)`)).toEqual([]);
    });

    test("a `var()` with a fallback that is the name it set", () => {
      expect(rules(`@@(\n  --accent: red;\n  color: var(--accent, blue);\n)`)).toEqual([]);
    });
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
      ["calc, which can be any type", `syntax: "<length>"; inherits: false; initial-value: calc(1px + 2em);`],
      ["a component with no matcher", `syntax: "<transform-list>"; inherits: false; initial-value: rotate(0deg);`],
      ["a multiplier, which this does not read", `syntax: "<length>+"; inherits: false; initial-value: 1px 2px;`],
      ["no initial-value at all, a different fault", `syntax: "*"; inherits: false;`],
    ])("%s", (_what, body) => {
      expect(rules(property(body))).toEqual([]);
    });

    test("a syntax written as a hole, which cannot be read", () => {
      expect(rules(property(`syntax: {shape}; inherits: false; initial-value: 12px;`))).toEqual([]);
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
    ])("%s", (_what, source) => {
      expect(rules(source)).toEqual([]);
    });

    test("a syntax with no matcher silences it, as it does for `initial-value`", () => {
      const list = `const t = @@property( syntax: "<transform-list>"; inherits: false; initial-value: none; );\n`;

      expect(rules(`${list}const s = @@( {t}: 12px; );\n`)).toEqual([]);
    });
  });
});
