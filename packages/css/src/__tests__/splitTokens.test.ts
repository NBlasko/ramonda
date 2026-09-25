import { describe, expect, test } from "vitest";
import { splitTokens } from "../compiler/split";
import { TOKEN_SHAPES } from "../compiler/tokenShapes.generated";

/**
 * Splitting a bag-of-tokens shorthand, from the table the engines agreed on.
 *
 * Whether a split produces the same page is answered where it can be: inside
 * `scripts/build-token-shapes.mjs`, which reproduces every family's own corpus in Chromium, Firefox
 * and WebKit before writing a row. These are the questions no browser answers — what the function
 * does with a value it must REFUSE, and that it reads the shape rather than guessing.
 */

const shapeOf = (name: string) => {
  const shape = TOKEN_SHAPES[name];
  if (shape === undefined) throw new Error(`no shape for ${name} — regenerate the table`);
  return shape;
};

describe("a value written in any order", () => {
  test("each token finds its own longhand", () => {
    expect(splitTokens(shapeOf("border-top"), "1px solid red")).toEqual({
      "border-top-width": "1px",
      "border-top-style": "solid",
      "border-top-color": "red",
    });
  });

  test("and the order it was written in does not matter", () => {
    expect(splitTokens(shapeOf("border-top"), "red 1px solid")).toEqual(
      splitTokens(shapeOf("border-top"), "1px solid red"),
    );
  });

  /** Every longhand the shorthand resets is written, which is what makes the split equivalent. */
  test("a longhand no token reached is reset, not left out", () => {
    expect(splitTokens(shapeOf("border-top"), "solid")).toEqual({
      "border-top-width": "initial",
      "border-top-style": "solid",
      "border-top-color": "initial",
    });
  });

  test("a colour is recognised as a call, a hex and a name alike", () => {
    for (const colour of ["rgb(1 2 3)", "#abcdef", "rebeccapurple"])
      expect(splitTokens(shapeOf("border-top"), colour)?.["border-top-color"]).toBe(colour);
  });

  test("a length is recognised by its unit, not by a list of values", () => {
    expect(splitTokens(shapeOf("border-top"), "2.5rem")?.["border-top-width"]).toBe("2.5rem");
  });
});

/**
 * The pass order, which is the one thing in here that a reordering would break silently.
 *
 * `list-style-type` takes a `custom-ident`, so it accepts nearly any word and has to be asked last.
 * It also lists `none` exactly. Match the primitives before the words and `none` walks past it into
 * `list-style-image`, which is a different declaration and the same-looking output.
 */
describe("an open slot", () => {
  test("takes a word it lists exactly, before any other slot sees it", () => {
    expect(splitTokens(shapeOf("list-style"), "none")?.["list-style-type"]).toBe("none");
  });

  test("but takes a free identifier only once every closed slot has declined", () => {
    expect(splitTokens(shapeOf("list-style"), "url(a.png) inside")).toEqual({
      "list-style-type": "initial",
      "list-style-position": "inside",
      "list-style-image": "url(a.png)",
    });
  });

  test("and a word nothing else claims lands in it", () => {
    expect(splitTokens(shapeOf("list-style"), "upper-roman")?.["list-style-type"]).toBe("upper-roman");
  });
});

describe("what it refuses, so the shorthand stays whole", () => {
  test("a `var()`, whose contents no table can know", () => {
    expect(splitTokens(shapeOf("border-top"), "var(--edge)")).toBeUndefined();
  });

  /**
   * The guard has to be tested where it is the ONLY thing refusing.
   *
   * On `border-top` a comma leaves a token — `red,` — that no slot takes, so the split refuses
   * whether the guard is there or not, and the test passes over a guard that has been deleted.
   * `list-style-type` takes a free identifier, so it swallows `square,` happily and emits an
   * invalid declaration. That is the case the guard exists for.
   */
  test("a comma, which the shape does not describe", () => {
    expect(splitTokens(shapeOf("list-style"), "square, inside")).toBeUndefined();
  });

  test("a slash, likewise", () => {
    expect(splitTokens(shapeOf("list-style"), "square/inside")).toBeUndefined();
  });

  test("an empty value", () => {
    expect(splitTokens(shapeOf("border-top"), "   ")).toBeUndefined();
  });

  /**
   * A slot takes ONE token, and two families want more.
   *
   * `text-decoration-line` is `none | [underline || overline || line-through || blink]`, so two of
   * those stand together legally and the second finds no free slot. Measured over every pair of
   * words in the table, the engines accept ten values this turns down, all in `text-decoration` and
   * `position-try`. Refusing is what the compiler did for them before a splitter existed.
   */
  test("two keywords a single slot takes together", () => {
    expect(splitTokens(shapeOf("text-decoration"), "underline overline")).toBeUndefined();
  });

  test("a token no slot will take", () => {
    expect(splitTokens(shapeOf("border-top"), "1px solid red 9px 8px")).toBeUndefined();
  });

  /** A unit CSS does not have makes the token nothing, and nothing is not a width. */
  test("a number carrying a unit no primitive claims", () => {
    expect(splitTokens(shapeOf("border-top"), "5zz")).toBeUndefined();
  });

  test("a bare number, which is not a length either", () => {
    expect(splitTokens(shapeOf("border-top"), "5")).toBeUndefined();
  });

  /** A call this family does not take is refused rather than dropped into whatever is free. */
  test("a function no slot lists", () => {
    expect(splitTokens(shapeOf("border-top"), "steps(4)")).toBeUndefined();
  });
});

describe("a CSS-wide keyword is not a component value", () => {
  test("it goes on every longhand the family resets", () => {
    expect(splitTokens(shapeOf("border-top"), "inherit")).toEqual({
      "border-top-width": "inherit",
      "border-top-style": "inherit",
      "border-top-color": "inherit",
    });
  });

  /** CSS has no such form either, so refusing it is mirroring the language rather than giving up. */
  test("and beside another value it is refused", () => {
    expect(splitTokens(shapeOf("border-top"), "1px inherit")).toBeUndefined();
  });
});

/**
 * The boundary of the table, asserted so that widening it is a deliberate act.
 *
 * These families have a comma, a slash or a repetition in their grammar, so a value of theirs is
 * not a bag of tokens and no row was written. They keep their shorthand.
 */
describe("the families this cannot answer are absent, not wrong", () => {
  test.each(["background", "animation", "transition", "mask", "font", "grid"])("%s has no shape", (name) => {
    expect(TOKEN_SHAPES[name]).toBeUndefined();
  });

  test("while the whole border family does", () => {
    for (const name of ["border", "border-top", "border-block", "border-inline-end"])
      expect(TOKEN_SHAPES[name]).toBeDefined();
  });
});
