import { describe, expect, test } from "vitest";
import { SHAPES } from "../compiler/shapes.generated";
import { splitPositional, tokensOf } from "../compiler/split";

/**
 * Splitting a positional shorthand, from the table the engines wrote.
 *
 * The table itself is checked against the engines by `scripts/check-shorthand-split.mjs`, over
 * thousands of values in a real browser — that is where "does this produce the same page" is
 * answered. These are the questions a browser cannot answer: what the function does with a value
 * it must REFUSE, and that it reads the shape rather than guessing.
 */

const shapeOf = (name: string) => {
  const shape = SHAPES[name];
  if (shape === undefined) throw new Error(`no shape for ${name} — regenerate the table`);
  return shape;
};

describe("top-level tokens", () => {
  test("splits on whitespace", () => {
    expect(tokensOf("1px 2px")).toEqual(["1px", "2px"]);
  });

  /**
   * The first thing the engines caught, before a line of the splitter existed: splitting on every
   * space tore `rgb(1, 1, 1)` into three values, and every colour in a shorthand with it.
   */
  test("a call is one value, however many spaces are inside it", () => {
    expect(tokensOf("rgb(1, 1, 1) solid")).toEqual(["rgb(1, 1, 1)", "solid"]);
  });

  test("nested calls stay whole", () => {
    expect(tokensOf("min(1px, max(2px, 3px)) 4px")).toEqual(["min(1px, max(2px, 3px))", "4px"]);
  });

  test("the separator is a parameter, because a slash divides a value too", () => {
    expect(tokensOf("1px 2px / 3px", /\//)).toEqual(["1px 2px ", " 3px"]);
  });

  test("empty between separators is dropped", () => {
    expect(tokensOf("  1px   2px  ")).toEqual(["1px", "2px"]);
  });
});

describe("what a value splits into", () => {
  test("one value reaches every side", () => {
    expect(splitPositional(shapeOf("padding"), "10px")).toEqual({
      "padding-top": "10px",
      "padding-right": "10px",
      "padding-bottom": "10px",
      "padding-left": "10px",
    });
  });

  test("two values pair the way the engines said they do", () => {
    expect(splitPositional(shapeOf("padding"), "10px 20px")).toEqual({
      "padding-top": "10px",
      "padding-right": "20px",
      "padding-bottom": "10px",
      "padding-left": "20px",
    });
  });

  test("four values go clockwise", () => {
    expect(splitPositional(shapeOf("margin"), "1px 2px 3px 4px")).toEqual({
      "margin-top": "1px",
      "margin-right": "2px",
      "margin-bottom": "3px",
      "margin-left": "4px",
    });
  });

  /**
   * A slash is not always one value split in half — `border-radius: 1px / 2px` is a horizontal and
   * a vertical radius, and every corner takes one of each.
   */
  test("a slash pairs the two sides rather than filling four corners", () => {
    expect(splitPositional(shapeOf("border-radius"), "1px 2px / 3px 4px")).toEqual({
      "border-top-left-radius": "1px 3px",
      "border-top-right-radius": "2px 4px",
      "border-bottom-right-radius": "1px 3px",
      "border-bottom-left-radius": "2px 4px",
    });
  });

  test("a value the shape has a constant for keeps it", () => {
    const split = splitPositional(shapeOf("background-position"), "3px");

    expect(split?.["background-position-x"]).toBe("3px");
    expect(split?.["background-position-y"]).not.toBe("3px");
  });
});

describe("what it refuses, and why refusing is an answer", () => {
  /**
   * A `var()` may carry SEVERAL values, and which is not known until computed-value time. Measured
   * in three engines: `border-color: var(--c)` with `--c: red blue` renders red/blue/red/blue,
   * while `var(--c)` on each longhand is four invalid declarations and a black border.
   */
  test("a `var()` anywhere in the value", () => {
    expect(splitPositional(shapeOf("padding"), "var(--x)")).toBeUndefined();
    expect(splitPositional(shapeOf("padding"), "10px var(--x)")).toBeUndefined();
  });

  /** A CSS-wide keyword beside a real value is invalid CSS, and the checker's to report. */
  test("a CSS-wide keyword beside a value", () => {
    expect(splitPositional(shapeOf("padding"), "10px inherit")).toBeUndefined();
  });

  /** ALONE it is not a component value at all: it goes on every longhand. */
  test("but a CSS-wide keyword alone goes on every longhand", () => {
    expect(splitPositional(shapeOf("padding"), "inherit")).toEqual({
      "padding-top": "inherit",
      "padding-right": "inherit",
      "padding-bottom": "inherit",
      "padding-left": "inherit",
    });
  });

  test("an arity no engine accepted, so nothing was measured for it", () => {
    expect(splitPositional(shapeOf("overflow"), "auto hidden clip scroll")).toBeUndefined();
  });

  test("a shape with no patterns at all", () => {
    expect(splitPositional({ kind: "length", patterns: {} }, "10px")).toBeUndefined();
  });
});
