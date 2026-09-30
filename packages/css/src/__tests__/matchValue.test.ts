import { describe, expect, test } from "vitest";
import { matchValue } from "../compiler/matchValue";
import { parseValueSyntax } from "../compiler/valueSyntax";

/**
 * Reading a value AGAINST its grammar, which is what filling slots could not do.
 *
 * Filling a list of SLOTS hands a token to the first one that takes it, and CSS hands it
 * to whichever component the grammar reaches first — measured, `animation: --zz` is a name to all
 * three engines and a timeline to the passes. The difference only closes with a real parse, because
 * the answer needs BACKTRACKING: `animation: spin` puts `spin` in the name because nothing else
 * wants it, and `animation: ease` does not, because `ease` is a timing function and the name can go
 * without.
 */

/** A recogniser good enough to test the shapes: a type by name, a keyword by spelling. */
const accepts = (term: { kind: string; name?: string }, token: string): boolean => {
  if (term.kind === "keyword") return term.name === token;
  if (term.kind === "literal") return term.name === token;
  if (term.name === "time") return /^\d+m?s$/.test(token);
  if (term.name === "length") return /^\d+px$/.test(token);
  // A `--name` IS a custom-ident here, because the engines put `animation: --zz` in the name.
  if (term.name === "custom-ident") return /^-{0,2}[a-z][\w-]*$/i.test(token) || token.startsWith("--");
  if (term.name === "dashed-ident") return token.startsWith("--");
  return false;
};

/** What each component took, as `name=tokens` pairs, so a test reads as the answer. */
const taken = (source: string, value: string) => {
  const found = matchValue(parseValueSyntax(source), value.split(" "), accepts);
  if (found === undefined) return undefined;
  return [...found].map(([term, tokens]) => `${term.name ?? term.kind}=${tokens.join(" ")}`).sort();
};

describe("one component at a time", () => {
  test("a keyword takes its own word", () => {
    expect(taken("none", "none")).toEqual(["none=none"]);
  });

  test("a type takes a token it accepts", () => {
    expect(taken("<time>", "1s")).toEqual(["time=1s"]);
  });

  test("and refuses one it does not", () => {
    expect(taken("<time>", "red")).toBeUndefined();
  });

  test("a value with a token left over does not match", () => {
    expect(taken("<time>", "1s 2s")).toBeUndefined();
  });
});

describe("the combinators", () => {
  test("juxtaposition is in order", () => {
    expect(taken("<custom-ident> <time>", "spin 1s")).toEqual(["custom-ident=spin", "time=1s"]);
  });

  test("and refuses the other order", () => {
    expect(taken("<custom-ident> <time>", "1s spin")).toBeUndefined();
  });

  test("`|` takes whichever branch fits", () => {
    expect(taken("none | <time>", "1s")).toEqual(["time=1s"]);
    expect(taken("none | <time>", "none")).toEqual(["none=none"]);
  });

  test("`&&` takes all of them, in any order", () => {
    expect(taken("<custom-ident> && <time>", "1s spin")).toEqual(["custom-ident=spin", "time=1s"]);
  });

  test("and refuses when one is missing", () => {
    expect(taken("<custom-ident> && <time>", "spin")).toBeUndefined();
  });

  test("`||` takes any of them, in any order", () => {
    expect(taken("<custom-ident> || <time>", "1s")).toEqual(["time=1s"]);
    expect(taken("<custom-ident> || <time>", "spin 1s")).toEqual(["custom-ident=spin", "time=1s"]);
  });

  test("but not none of them", () => {
    expect(taken("<custom-ident> || <time>", "")).toBeUndefined();
  });
});

describe("multipliers", () => {
  test("`?` may be absent", () => {
    expect(taken("<custom-ident> <time>?", "spin")).toEqual(["custom-ident=spin"]);
  });

  test("`{1,2}` takes up to its maximum", () => {
    expect(taken("<time>{1,2}", "1s 2s")).toEqual(["time=1s 2s"]);
  });

  test("and no more than that", () => {
    expect(taken("<time>{1,2}", "1s 2s 3s")).toBeUndefined();
  });
});

/**
 * The cases that made this exist, and the reason a slot could not answer them.
 *
 * `--zz` is a `dashed-ident` and a `custom-ident` both, so a slot sees two takers and picks by its
 * own order. The grammar picks by ITS order, and the parse follows the grammar.
 */
describe("what the passes got wrong", () => {
  const ANIMATION = "[ none | <custom-ident> ] || <time> || <dashed-ident>";

  test("a bare identifier is the name, not the timeline", () => {
    expect(taken(ANIMATION, "--zz")).toEqual(["custom-ident=--zz"]);
  });

  test("and the timeline is reached when the name is already taken", () => {
    expect(taken(ANIMATION, "spin --zz")).toEqual(["custom-ident=spin", "dashed-ident=--zz"]);
  });

  /**
   * Backtracking: the first branch fits the first token and then nothing fits the second.
   *
   * Two entries and not one, because the two `<time>`s are different places in the grammar — which
   * is exactly what a caller needs to tell `transition-duration` from `transition-delay`.
   */
  test("a first choice that dead-ends is given up", () => {
    expect(taken("[ <custom-ident> | <time> ] <time>", "1s 2s")).toEqual(["time=1s", "time=2s"]);
  });
});

/**
 * `||` means AT LEAST ONE, and the difference only shows inside a sequence.
 *
 * At the top a value has to consume every token, so a group that took nothing gets caught by the
 * token left over. Standing before another component it is not caught: the group is skipped, the
 * rest of the sequence lines up, and the parse is accepted. Every comma family's item grammar is a
 * `||` group, so this is the shape they are all written in.
 */
describe("a group of alternatives takes at least one", () => {
  test("a required `||` group cannot be skipped", () => {
    expect(taken("[ none || <time> ] <length>", "3px")).toBeUndefined();
  });

  test("but one of them is enough", () => {
    expect(taken("[ none || <time> ] <length>", "none 3px")).toEqual(["length=3px", "none=none"]);
  });

  test("and an OPTIONAL one may still be skipped", () => {
    expect(taken("[ none || <time> ]? <length>", "3px")).toEqual(["length=3px"]);
  });
});

/**
 * A multiplier without an upper bound, which is how every comma family is written.
 *
 * `<time>#` parses as `repeat: { min: 1, max: Infinity }`, and the count was counted DOWN from the
 * maximum — `Infinity - 1` is `Infinity`, so the loop never reached the minimum and never returned.
 * It hid because a probe printed the term through `JSON.stringify`, which writes `Infinity` as
 * `null`, and `null` read as "no maximum given, so one".
 *
 * These carry a timeout because the fault they cover is a hang, and a hanging test tells nobody
 * anything.
 */
describe("a multiplier with no upper bound", () => {
  test("one item is a list of one", { timeout: 2000 }, () => {
    expect(taken("<time>#", "1s")).toEqual(["time=1s"]);
  });

  test("and the comma separates the rest", { timeout: 2000 }, () => {
    expect(taken("<time>#", "1s , 2s , 3s")).toEqual(["time=1s 2s 3s"]);
  });

  test("a repetition without commas takes each in turn", { timeout: 2000 }, () => {
    expect(taken("<length>+", "1px 2px")).toEqual(["length=1px 2px"]);
  });

  test("more tokens than the grammar can take is still no answer", { timeout: 2000 }, () => {
    expect(taken("<time>#", "1s 2s")).toBeUndefined();
  });
});
