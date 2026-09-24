import { describe, expect, test } from "vitest";
import { SyntaxNotationError, alternativesOf, componentsOf, parseValueSyntax } from "../compiler/valueSyntax";

/**
 * The reader for CSS's value definition syntax.
 *
 * What it has to be exactly right about is PRECEDENCE: `a | b c` is one alternative against a
 * sequence, and a flat split on `|` reads it as three things and cannot be told it is wrong. Every
 * grammar this package will classify a shorthand from goes through here.
 */

const parse = (source: string) => parseValueSyntax(source);
const names = (source: string) => componentsOf(parse(source)).map((one) => one.name);

describe("the combinators, loosest to tightest", () => {
  test("`|` is a choice, and the branches are kept apart", () => {
    const term = parse("none | auto");

    expect(term.kind).toBe("alt");
    expect(alternativesOf(term).map((one) => one.name)).toEqual(["none", "auto"]);
  });

  test("`||` is one or more in any order", () => {
    expect(parse("<length> || <color>").kind).toBe("or");
    expect(names("<line-width> || <line-style> || <color>")).toEqual(["line-width", "line-style", "color"]);
  });

  test("`&&` is both in any order", () => {
    expect(parse("<length> && <color>").kind).toBe("and");
  });

  test("juxtaposition is both in order", () => {
    expect(parse("<length> <color>").kind).toBe("seq");
  });

  /**
   * The one that a flat split gets wrong. `a | b c` is `a` OR `(b c)` — not three things, and not
   * `(a | b) c` either.
   */
  test("`|` binds loosest, so a sequence beside it is one branch", () => {
    const branches = alternativesOf(parse("none | <length> <color>"));

    expect(branches).toHaveLength(2);
    expect(branches[0].name).toBe("none");
    expect(branches[1].kind).toBe("seq");
  });

  test("and `||` binds looser than `&&`", () => {
    const term = parse("<a> || <b> && <c>");

    expect(term.kind).toBe("or");
    expect(term.terms?.[1].kind).toBe("and");
  });
});

describe("what a term can be", () => {
  test("a data type", () => {
    expect(parse("<length>")).toMatchObject({ kind: "data", name: "length" });
  });

  test("a property's own value", () => {
    expect(parse("<'padding-top'>")).toMatchObject({ kind: "property", name: "padding-top" });
  });

  test("a keyword", () => {
    expect(parse("inherit")).toMatchObject({ kind: "keyword", name: "inherit" });
  });

  /** A range belongs to the TYPE. `<time [0s,∞]>` is a time, and the bounds are not this reader's. */
  test("a range inside a type is part of the type", () => {
    expect(parse("<time [0s,∞]>")).toMatchObject({ kind: "data", name: "time" });
  });

  test("a slash and a comma are themselves, and are not components", () => {
    expect(names("<length> / <length>")).toEqual(["length", "length"]);
  });
});

describe("the multipliers", () => {
  test("`?` is optional", () => {
    expect(parse("<length>?").optional).toBe(true);
  });

  test("`#` is a comma-separated list", () => {
    expect(parse("<length>#")).toMatchObject({ comma: true, repeat: { min: 1, max: Infinity } });
  });

  test("`{1,4}` is a count", () => {
    expect(parse("<length>{1,4}").repeat).toEqual({ min: 1, max: 4 });
  });

  test("`{0,3}` is optional too", () => {
    expect(parse("<length>{0,3}").optional).toBe(true);
  });

  test("`*` is optional and unbounded", () => {
    expect(parse("<length>*")).toMatchObject({ optional: true, repeat: { min: 0, max: Infinity } });
  });

  test("a multiplier binds to the group it follows", () => {
    expect(parse("[ <length> <color> ]#")).toMatchObject({ kind: "seq", comma: true });
  });
});

describe("grouping", () => {
  test("brackets change what a combinator joins", () => {
    const term = parse("[ none | auto ] <length>");

    expect(term.kind).toBe("seq");
    expect(term.terms?.[0].kind).toBe("alt");
  });

  test("nesting is read to the bottom", () => {
    expect(names("[ [ <a> || <b> ] <c> ]")).toEqual(["a", "b", "c"]);
  });
});

describe("real grammars, as published", () => {
  test("border", () => {
    expect(names("<line-width> || <line-style> || <color>")).toEqual(["line-width", "line-style", "color"]);
  });

  test("single-animation keeps duration and delay apart, in order", () => {
    const written =
      "<'animation-duration'> || <easing-function> || <'animation-delay'> || <single-animation-iteration-count>";

    expect(names(written)).toEqual([
      "animation-duration",
      "easing-function",
      "animation-delay",
      "single-animation-iteration-count",
    ]);
  });

  test("flex is a choice, and only one branch has components", () => {
    const branches = alternativesOf(parse("none | [ <'flex-grow'> <'flex-shrink'>? || <'flex-basis'> ]"));

    expect(branches).toHaveLength(2);
    expect(componentsOf(branches[1]).map((one) => one.name)).toEqual(["flex-grow", "flex-shrink", "flex-basis"]);
  });

  test("a bg-layer's slash form", () => {
    expect(names("<bg-image> || <bg-position> [ / <bg-size> ]? || <repeat-style>")).toEqual([
      "bg-image",
      "bg-position",
      "bg-size",
      "repeat-style",
    ]);
  });
});

describe("notation it does not understand is refused, not guessed", () => {
  test("an unclosed group", () => {
    expect(() => parse("[ <length>")).toThrow(SyntaxNotationError);
  });

  test("an unclosed type", () => {
    expect(() => parse("<length")).toThrow(SyntaxNotationError);
  });

  test("an unclosed count", () => {
    expect(() => parse("<length>{1,4")).toThrow(SyntaxNotationError);
  });

  test("a stray closing bracket", () => {
    expect(() => parse("<length> ]")).toThrow(/left over/);
  });

  test("nothing at all", () => {
    expect(() => parse("")).toThrow(SyntaxNotationError);
  });

  test("a character that is not notation", () => {
    expect(() => parse("<length> @")).toThrow(SyntaxNotationError);
  });

  /**
   * Measured against every grammar `mdn-data` publishes: 1021 of 1029 read. These are the eight,
   * and none of them is a VALUE grammar — a block, a list of at-rule names, media-query and
   * selector syntax with `:` and `;` in it, and one carrying a footnote dagger. Nothing classifies
   * a shorthand from a selector, so refusing them is the answer rather than a gap.
   */
  test.each([
    ["a block", "<keyframe-selector># {\n  <declaration-list>\n}"],
    ["at-rule names", "@stylistic | @historical-forms"],
    ["a declaration", "<custom-ident>: <integer>+;"],
    ["a media feature", "<mf-name> : <mf-value>"],
    ["a page selector", ": [ left | right | first | blank ]"],
    ["a footnote dagger", "odd | even | <integer> | '+'?\u2020 n"],
  ])("%s is not a value grammar and is refused", (_what, source) => {
    expect(() => parse(source)).toThrow(SyntaxNotationError);
  });
});
