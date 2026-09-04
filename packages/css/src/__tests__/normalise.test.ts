import { describe, expect, test } from "vitest";
import type { Block, BlockItem } from "../compiler/ast";
import { HOLE, normalise } from "../compiler/normalise";

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
