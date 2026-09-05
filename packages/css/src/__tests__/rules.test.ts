import { describe, expect, test } from "vitest";
import { KEYWORDS, PROPERTIES } from "../compiler/keywords.generated";
import { readBlock } from "../compiler/read";
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
    ["a value that is entirely a hole", "  display: {{how}};"],
    ["a hole beside text", "  padding: {{n}}px;"],
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
   * A unit typo is deliberately NOT reported. `10pxx` is not a bare identifier — it starts with a
   * digit — and a rule that read numbers would need a value grammar, which is the thing this
   * carefully does not have. Said out loud so nobody adds it by pattern later.
   */
  test("a unit typo is left alone, because judging it needs a grammar this does not have", () => {
    expect(rules("  padding: 10pxx;")).toEqual([]);
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
    ["the same property with a hole in one of them", "  color: red;\n  color: {{accent}};"],
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
    ["a property name", "  {{name}}: 24px;"],
    ["a whole declaration", `  {{cond ? "display:flex" : ""}}`],
    ["a selector", "  &:{{state}} { color: red; }"],
  ])("%s is named", (_what, css) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("hole-out-of-place");
    expect(only.message).toContain("value");
  });

  test("and a hole in a value is exactly where one belongs", () => {
    expect(rules("  border-left: 4px solid {{accent}};")).toEqual([]);
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
    ["a hole", `padding: {{size}};`],
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
    ["a unit after a hole", `gap: {{n}}px;`],
    ["one on a property that takes no keywords", `padding: {{n}}px;`],
    ["two holes, one unit", `margin: {{a}} {{b}}px;`],
    ["a unit in the middle of a shorthand", `border-left: {{w}}px solid red;`],
    ["a word before a hole", `grid-template-columns: minmax(0,{{n}}fr);`],
  ])("%s is silent", (_what, css) => {
    expect(check(css)).toEqual([]);
  });

  test.each([
    ["a typo beside a glued unit", `border-left: {{w}}px sollid red;`, "sollid"],
    ["a separate word after a hole", `gap: {{n}} auto;`, "auto"],
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
    ["one inside a hole", `color: {{cond ? "red" : "blue"}}; /* fine */`],
  ])("%s is not one", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "line-comment")).toEqual([]);
  });
});
