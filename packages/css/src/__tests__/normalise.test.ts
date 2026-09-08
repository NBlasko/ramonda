import { describe, expect, test } from "vitest";
import type { Block, BlockItem } from "../compiler/ast";
import { HOLE, canonicalCondition, canonicalSelector, normalise } from "../compiler/normalise";

/**
 * Normalisation IS identity, so this file is what decides which blocks share a class.
 *
 * The asymmetry it is written around: two blocks that normalise the same get ONE rule, so a wrong
 * merge is a silent visual bug in a page nobody edited, while a missed merge is one duplicate rule
 * in a stylesheet. The first is unbounded and the second is a few bytes — so every case below that
 * asserts a DIFFERENCE is load-bearing, and the ones that assert a match are conveniences.
 */

/** One declaration. A number in the value is a hole with that index, so the tests read as CSS. */
function decl(property: string, ...value: (string | number)[]): BlockItem {
  return {
    kind: "declaration",
    property,
    value: value.map((part) =>
      typeof part === "number" ? ({ kind: "hole", index: part } as const) : ({ kind: "text", text: part } as const),
    ),
  };
}

function rule(prelude: string, ...items: BlockItem[]): BlockItem {
  return { kind: "rule", prelude, items };
}

const block = (...items: BlockItem[]): Block => ({ items });

/** A hole placeholder, built from the normaliser's own delimiter rather than typed out. */
const hole = (index: number) => `${HOLE}${index}${HOLE}`;

describe("what normalisation is allowed to throw away", () => {
  test.each([
    ["runs of whitespace in a value", block(decl("margin", "1px   2px")), block(decl("margin", "1px 2px"))],
    ["a newline in a value", block(decl("margin", "1px\n  2px")), block(decl("margin", "1px 2px"))],
    ["whitespace at the ends of a value", block(decl("color", "  red  ")), block(decl("color", "red"))],
    ["the case of a property name", block(decl("COLOR", "red")), block(decl("color", "red"))],
    [
      "whitespace at the ends of a prelude",
      block(rule("&:hover ", decl("color", "red"))),
      block(rule("&:hover", decl("color", "red"))),
    ],
    [
      "the file it was written in — the same block twice is one class",
      block(decl("display", "flex"), decl("gap", "8px")),
      block(decl("display", "flex"), decl("gap", "8px")),
    ],
  ])("%s", (_what, a, b) => {
    expect(normalise(a)).toBe(normalise(b));
  });
});

describe("what it may never throw away", () => {
  test.each([
    [
      "the space before a hole, which is a token separator",
      block(decl("border", "4px solid ", 0)),
      block(decl("border", "4px solid", 0)),
    ],
    [
      "the order of two declarations",
      block(decl("margin", "1px"), decl("margin-left", "2px")),
      block(decl("margin-left", "2px"), decl("margin", "1px")),
    ],
    ["whitespace inside a string", block(decl("content", '"a  b"')), block(decl("content", '"a b"'))],
    [
      "the case of a custom property, which CSS reads as significant",
      block(decl("--Accent", "red")),
      block(decl("--accent", "red")),
    ],
    [
      "a descendant combinator",
      block(rule("& .title", decl("color", "red"))),
      block(rule("&.title", decl("color", "red"))),
    ],
    ["how many holes there are", block(decl("color", 0)), block(decl("color", 0), decl("background", 1))],
    [
      "which hole goes where",
      block(decl("color", 0), decl("background", 1)),
      block(decl("color", 1), decl("background", 0)),
    ],
    [
      "a declaration nested in a rule, versus the same declaration beside it",
      block(rule("&:hover", decl("color", "red"))),
      block(decl("color", "red")),
    ],
  ])("%s", (_what, a, b) => {
    expect(normalise(a)).not.toBe(normalise(b));
  });
});

describe("the canonical form itself", () => {
  test("a declaration ends in a semicolon whether or not the author wrote one", () => {
    expect(normalise(block(decl("display", "flex")))).toBe("display:flex;");
  });

  test("a nested rule keeps its prelude and wraps its own items", () => {
    expect(normalise(block(decl("color", "red"), rule("&:hover", decl("color", "blue"))))).toBe(
      "color:red;&:hover{color:blue;}",
    );
  });

  test("a hole is a placeholder that CSS source cannot contain", () => {
    // U+0000 becomes U+FFFD during CSS preprocessing, so no author can write one into a block and
    // collide with a placeholder. That is the whole reason it is the delimiter.
    expect(normalise(block(decl("border-left", "4px solid ", 0)))).toBe(`border-left:4px solid ${hole(0)};`);
  });

  test("a string's own whitespace survives the collapse around it", () => {
    expect(normalise(block(decl("content", '  "a  b"   ')))).toBe('content:"a  b";');
  });

  test("an escaped quote does not end the string it is in", () => {
    expect(normalise(block(decl("content", '"a\\"  b"')))).toBe('content:"a\\"  b";');
  });
});

/**
 * ONE SPELLING for a condition and a selector, which is what keeps two files from disagreeing.
 *
 * CSS is case-insensitive about the words of the LANGUAGE — an at-rule's name, a media feature's
 * name, a pseudo-class's name — and case-sensitive about an author's own identifiers: a class, an
 * id, an attribute value, a custom ident. Measured with lightningcss, `:hover` and `:HOVER` are one
 * rule while `.a` and `.A` are two.
 *
 * **So the compiler cannot fold a selector's case**, and a review measured what happens when it does
 * not fold at all: the `key` a declaration is overridden by is its own TEXT, so a base written
 * `@media (min-width:40rem)` and a modifier written `@media (min-width: 40rem)` — the same CSS, one
 * space apart — became two keys, the merge kept both classes, and which one won was decided by
 * whichever file the bundler reached first.
 *
 * The answer chosen with the user is to make the SOURCE canonical instead: there is one way to write
 * each of these, the checker says so, and the formatter writes it for you. The invariant becomes
 * "there is only one spelling" rather than "the compiler normalises every spelling", which is far
 * cheaper to be right about — and it leaves an author's own identifiers untouched.
 *
 * **The rule reports exactly what the canonicaliser changes.** One function, asked two ways: the
 * checker asks whether it would change the text, the formatter applies it. So a shape it cannot
 * canonicalise is never reported — an error with no fix is worse than a spelling — and the two can
 * never drift, which is the fault this repository keeps finding.
 */
describe("one spelling for a condition and a selector", () => {
  test.each([
    ["a pseudo-class in capitals", "&:HOVER", "&:hover"],
    ["mixed case", "&:Focus-Visible", "&:focus-visible"],
    ["a legacy pseudo-element", "&:before", "&::before"],
    ["another", "&:after", "&::after"],
    ["a legacy first-line", "&:first-line", "&::first-line"],
    ["a pseudo-element already written with two colons", "&::before", "&::before"],
    ["a functional pseudo-class", "&:NOT(.a)", "&:not(.a)"],
    ["a class, which is the author's own and is LEFT ALONE", "&.Open", "&.Open"],
    ["an id", "&#Main", "&#Main"],
    ["an attribute value", '&[data-x="Y"]', '&[data-x="Y"]'],
    ["an attribute NAME, which HTML folds but the text does not", "&[HREF]", "&[HREF]"],
    ["a type selector", "DIV", "DIV"],
    ["a custom ident in a functional pseudo-class", "&:has(.Card)", "&:has(.Card)"],
  ])("%s", (_what, written, expected) => {
    expect(canonicalSelector(written)).toBe(expected);
  });

  test.each([
    ["an at-rule name in capitals", "@MEDIA print", "@media print"],
    ["a feature name in capitals", "@media (MIN-WIDTH: 40rem)", "@media (min-width: 40rem)"],
    ["no space after the colon", "@media (min-width:40rem)", "@media (min-width: 40rem)"],
    ["several spaces after it", "@media (min-width:   40rem)", "@media (min-width: 40rem)"],
    ["both at once", "@MEDIA (MIN-WIDTH:40rem)", "@media (min-width: 40rem)"],
    ["already canonical", "@media (min-width: 40rem)", "@media (min-width: 40rem)"],
    ["a supports condition", "@SUPPORTS (display:grid)", "@supports (display: grid)"],
    ["a container query", "@CONTAINER (width > 40rem)", "@container (width > 40rem)"],
    ["a layer, whose name is the AUTHOR'S", "@LAYER Base", "@layer Base"],
    ["a scope, whose selector is the author's", "@SCOPE (.Card)", "@scope (.Card)"],
    ["a keyword condition", "@media PRINT", "@media print"],
    ["an at-rule nobody here knows is left alone", "@invented X", "@invented X"],
  ])("%s", (_what, written, expected) => {
    expect(canonicalCondition(written)).toBe(expected);
  });

  /**
   * What the canonicaliser does not touch, so the rule says nothing about it either.
   *
   * Everything that is an author's own text: a class, an id, an attribute value, a `@layer` name, a
   * `@container` name, a `@scope` selector. Also a name nothing generated — a browser's pseudo-class
   * or a typo — because rewriting one would be guessing at what it meant.
   */
  test.each([
    ["a pseudo-class nobody generated", "&:NOT-A-THING"],
    ["a feature name nobody generated", "@media (NOT-A-FEATURE: 1)"],
  ])("%s is left as written", (_what, written) => {
    expect(written.startsWith("@") ? canonicalCondition(written) : canonicalSelector(written)).toBe(written);
  });

  /**
   * A VENDOR pseudo-element is lowered, because it is still the language's word rather than the
   * author's — a browser defined it, and the generated table holds it like any other.
   */
  test("a vendor pseudo-element is lowered, because the table has it", () => {
    expect(canonicalSelector("&::-WEBKIT-SLIDER-THUMB")).toBe("&::-webkit-slider-thumb");
  });
});

/**
 * The two spellings that used to be left alone, because each looked like it needed a real parse.
 *
 * It does for the general case and not for what people write. `:nth-child`'s `An+B` is a small
 * closed syntax, and one redundant pair of parens is one balanced group inside another. Both are
 * mechanical, so both are canonicalised — an author writes CSS one way, which is the point.
 */
describe("the two that looked like they needed a parser", () => {
  test.each([
    ["spaces around the sign", "&:nth-child(2n + 1)", "&:nth-child(2n+1)"],
    ["a minus", "&:nth-child(2n - 1)", "&:nth-child(2n-1)"],
    ["a leading sign", "&:nth-child(-n + 3)", "&:nth-child(-n+3)"],
    ["already tight", "&:nth-child(2n+1)", "&:nth-child(2n+1)"],
    ["a bare number", "&:nth-child( 3 )", "&:nth-child(3)"],
    ["a keyword", "&:nth-child( ODD )", "&:nth-child(odd)"],
    ["a capital N", "&:nth-child(2N+1)", "&:nth-child(2n+1)"],
    ["nth-last-child", "&:nth-last-child(2n + 1)", "&:nth-last-child(2n+1)"],
    ["nth-of-type", "&:nth-of-type(2n + 1)", "&:nth-of-type(2n+1)"],
    ["nth-last-of-type", "&:nth-last-of-type(2n + 1)", "&:nth-last-of-type(2n+1)"],
  ])("%s", (_what, written, expected) => {
    expect(canonicalSelector(written)).toBe(expected);
  });

  /** `of <selector>` holds a selector, whose whitespace is the author's and means something. */
  test.each([
    ["a selector after `of`", "&:nth-child(2n + 1 of .a b)", "&:nth-child(2n+1 of .a b)"],
    ["with no An+B to tighten", "&:nth-child(2n of .a b)", "&:nth-child(2n of .a b)"],
    ["a capitalised class after `of`", "&:nth-child(2n+1 of .Card)", "&:nth-child(2n+1 of .Card)"],
  ])("%s keeps what is after it", (_what, written, expected) => {
    expect(canonicalSelector(written)).toBe(expected);
  });

  test.each([
    ["one redundant pair", "@supports ((display: grid))", "@supports (display: grid)"],
    ["two", "@supports (((display: grid)))", "@supports (display: grid)"],
    ["already one pair", "@supports (display: grid)", "@supports (display: grid)"],
    ["and the colon is spaced inside it", "@supports ((display:grid))", "@supports (display: grid)"],
  ])("%s", (_what, written, expected) => {
    expect(canonicalCondition(written)).toBe(expected);
  });

  /** A paren that GROUPS is not redundant, and telling them apart is the whole care here. */
  test.each([
    ["an `and`", "@supports ((display: grid) and (gap: 1px))"],
    ["an `or`", "@supports ((display: grid) or (display: flex))"],
    ["a `not`", "@supports (not (display: grid))"],
    ["a selector query", "@supports selector(&:hover)"],
  ])("%s is left alone", (_what, written) => {
    expect(canonicalCondition(written)).toBe(written);
  });
});
