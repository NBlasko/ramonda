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

  /**
   * A longhand a family always sets to the same thing, whatever was written. `container: card`
   * names the container and leaves `container-type` at `normal` — the value is a constant of the
   * shape, not a slot of the written text.
   *
   * This asked the same of `background-position` until that family left the table: its corpus
   * gained the words its own longhands disagree about, and `center x-start` turned out to be a
   * value CSS ignores and a split answered.
   */
  test("a value the shape has a constant for keeps it", () => {
    const split = splitPositional(shapeOf("container"), "card");

    expect(split?.["container-name"]).toBe("card");
    expect(split?.["container-type"]).toBe("normal");
  });
});

/**
 * A word a longhand has no place for, which makes the WHOLE declaration invalid in CSS.
 *
 * `background-position-y` has no `x-start`, so `background-position: center x-start` sets nothing
 * in any browser. A split sets the x and leaves the y — the author's mistake stops doing nothing
 * and starts doing half of something, which is the rule this file already states for a negative.
 *
 * Only WORDS are checked. A length is the same to every longhand that takes lengths, and the one
 * range question — whether a negative is allowed — is `negative`, measured apart.
 */
describe("a word the longhand has no place for", () => {
  const SHAPE = {
    kind: "test",
    negative: true,
    patterns: {
      "2": { "a-x": { slots: [0] }, "a-y": { slots: [1] } },
    },
    takes: {
      "a-x": { words: ["left", "right", "center"], free: false },
      "a-y": { words: ["top", "bottom", "center"], free: false },
    },
  } as const;

  test("refuses the value, so the shorthand stays whole", () => {
    expect(splitPositional(SHAPE, "center left")).toBeUndefined();
  });

  test("while a word each longhand does have splits", () => {
    expect(splitPositional(SHAPE, "left top")).toEqual({ "a-x": "left", "a-y": "top" });
  });

  test("a length is not a word and is not checked", () => {
    expect(splitPositional(SHAPE, "1px 2px")).toEqual({ "a-x": "1px", "a-y": "2px" });
  });

  /** A longhand that takes a colour or a free identifier has no list, so it is not checked. */
  test("and a longhand with no list to check against is left alone", () => {
    const free = { ...SHAPE, takes: { ...SHAPE.takes, "a-y": { words: [], free: true } } } as const;

    expect(splitPositional(free, "center rebeccapurple")).toEqual({ "a-x": "center", "a-y": "rebeccapurple" });
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

  /**
   * CSS drops a whole declaration when any part of it is invalid; a split drops only the part.
   *
   * `padding: 10px -5px` leaves NO padding at all, and four longhands would leave 10px on top and
   * bottom — the author's mistake stops doing nothing and starts doing half of something. Which
   * families refuse a negative is measured, not listed: `margin` takes one and `padding` does not.
   */
  test("a negative length, where the family refuses one", () => {
    expect(splitPositional(shapeOf("padding"), "10px -5px")).toBeUndefined();
    expect(splitPositional(shapeOf("padding"), "-5px")).toBeUndefined();
  });

  test("but not where the family takes one", () => {
    expect(splitPositional(shapeOf("margin"), "10px -5px")).toEqual({
      "margin-top": "10px",
      "margin-right": "-5px",
      "margin-bottom": "10px",
      "margin-left": "-5px",
    });
  });

  /** It reads the written text, so what a function works out to is past it — and says so. */
  test("a negative inside a call is not seen, which is the boundary", () => {
    expect(splitPositional(shapeOf("padding"), "calc(4px - 9px)")).toEqual({
      "padding-top": "calc(4px - 9px)",
      "padding-right": "calc(4px - 9px)",
      "padding-bottom": "calc(4px - 9px)",
      "padding-left": "calc(4px - 9px)",
    });
  });

  test("a shape with no patterns at all", () => {
    expect(splitPositional({ kind: "length", negative: false, patterns: {} }, "10px")).toBeUndefined();
  });
});
