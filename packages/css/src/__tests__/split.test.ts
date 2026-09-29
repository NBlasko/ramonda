import { describe, expect, test } from "vitest";
import { SHAPES } from "../compiler/shapes.generated";
import { splitOf, splitPositional, tokensOf } from "../compiler/split";

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

/**
 * A word that is valid only as PART of a value, never on its own.
 *
 * `first baseline` and `safe center` are one value of two words: `place-items: first baseline`
 * sets both longhands to it. The positional split read two words as two values and wrote
 * `align-items: first`, which no engine accepts — so the align was dropped and the justify kept.
 * Found by review, in all three engines.
 *
 * `first` IS one of `align-items`'s words, so the word check lets it through, and it must: the
 * checker reads the same list, and `place-items: first baseline` is valid CSS it must not report.
 * What the SPLITTER needs is a second list — the words each engine takes as a longhand's WHOLE value.
 */
describe("a word that cannot stand alone in its slot", () => {
  const SHAPE = {
    kind: "test",
    negative: true,
    patterns: {
      "1": { "a-x": { slots: [0] }, "a-y": { slots: [0] } },
      "2": { "a-x": { slots: [0] }, "a-y": { slots: [1] } },
    },
    takes: {
      "a-x": { words: ["first", "baseline", "center"], free: false, alone: ["baseline", "center"] },
      "a-y": { words: ["first", "baseline", "center"], free: false, alone: ["baseline", "center"] },
    },
  } as const;

  test("refuses the value, so the shorthand stays whole", () => {
    expect(splitPositional(SHAPE, "first baseline")).toBeUndefined();
  });

  test("while words that stand alone still split", () => {
    expect(splitPositional(SHAPE, "baseline center")).toEqual({ "a-x": "baseline", "a-y": "center" });
  });

  test("a shape with no measured list is not held to one", () => {
    const { takes, ...rest } = SHAPE;
    const without = {
      ...rest,
      takes: { "a-x": { words: takes["a-x"].words, free: false }, "a-y": { words: takes["a-y"].words, free: false } },
    };

    expect(splitPositional(without, "first baseline")).toBeDefined();
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

describe("a var() in any spelling", () => {
  /**
   * A function name is case-insensitive in CSS, so `VAR(--p)` is a `var()`. The positional splitter
   * tested for the lower-case spelling only and split it. Measured in all three engines, `--p: 4px
   * 8px`: `padding: VAR(--p)` is 4px 8px, and the same `VAR(--p)` on each longhand is 0px — every
   * one of them invalid at computed time.
   */
  test("is refused whatever its case", () => {
    const padding = SHAPES.padding;
    expect(padding).toBeDefined();
    if (padding === undefined) return;
    for (const value of ["var(--p)", "VAR(--p)", "Var(--p) 1px"])
      expect(splitPositional(padding, value)).toBeUndefined();
  });
});

/**
 * The families split by hand — `splitByHand.ts`. What a value becomes is held against all three
 * engines by `check-hand-splits.mjs`; these hold the rules themselves, so a change to one is seen
 * without a browser.
 */
describe("a family split by hand", () => {
  test.each([
    ["flex", "none", { "flex-grow": "0", "flex-shrink": "0", "flex-basis": "auto" }],
    ["flex", "2", { "flex-grow": "2", "flex-shrink": "1", "flex-basis": "0%" }],
    ["flex", "10px", { "flex-grow": "1", "flex-shrink": "1", "flex-basis": "10px" }],
    ["white-space", "pre", { "white-space-collapse": "preserve", "text-wrap-mode": "nowrap" }],
    ["white-space", "nowrap", { "white-space-collapse": "collapse", "text-wrap-mode": "nowrap" }],
    [
      "grid-area",
      "a",
      { "grid-row-start": "a", "grid-column-start": "a", "grid-row-end": "a", "grid-column-end": "a" },
    ],
    [
      "grid-area",
      "1 / b",
      { "grid-row-start": "1", "grid-column-start": "b", "grid-row-end": "auto", "grid-column-end": "b" },
    ],
    ["marker", "url(#m)", { "marker-start": "url(#m)", "marker-mid": "url(#m)", "marker-end": "url(#m)" }],
    [
      "contain-intrinsic-size",
      "auto 10px",
      { "contain-intrinsic-width": "auto 10px", "contain-intrinsic-height": "auto 10px" },
    ],
  ])("%s: %s", (family, value, expected) => {
    expect(splitOf(family, value)).toEqual(expected);
  });

  test.each([
    ["a var()", "flex", "var(--f)"],
    ["a CSS-wide keyword, which grid-area would read as a line name", "grid-area", "inherit"],
    ["one beside a value", "grid-area", "a / inherit"],
    ["a word one engine refuses", "font-synthesis", "weight position"],
    ["an edge Chromium refuses", "text-box", "cap"],
    ["a basis between the two factors", "flex", "2 10px 3"],
  ])("refuses %s", (_what, family, value) => {
    expect(splitOf(family, value)).toBeUndefined();
  });
});

describe("every hand-split family, each way it can go", () => {
  test.each([
    ["marker", "none", { "marker-start": "none", "marker-mid": "none", "marker-end": "none" }],
    ["white-space", "normal", { "white-space-collapse": "collapse", "text-wrap-mode": "wrap" }],
    ["white-space", "preserve nowrap", { "white-space-collapse": "preserve", "text-wrap-mode": "nowrap" }],
    ["white-space", "break-spaces", { "white-space-collapse": "break-spaces", "text-wrap-mode": "wrap" }],
    [
      "font-synthesis",
      "weight style",
      {
        "font-synthesis-weight": "auto",
        "font-synthesis-style": "auto",
        "font-synthesis-small-caps": "none",
        "font-synthesis-position": "none",
      },
    ],
    [
      "font-synthesis",
      "none",
      {
        "font-synthesis-weight": "none",
        "font-synthesis-style": "none",
        "font-synthesis-small-caps": "none",
        "font-synthesis-position": "none",
      },
    ],
    ["-webkit-text-stroke", "1px red", { "-webkit-text-stroke-width": "1px", "-webkit-text-stroke-color": "red" }],
    ["-webkit-text-stroke", "blue", { "-webkit-text-stroke-width": "0", "-webkit-text-stroke-color": "blue" }],
    [
      "-webkit-text-stroke",
      "thin",
      { "-webkit-text-stroke-width": "thin", "-webkit-text-stroke-color": "currentcolor" },
    ],
    ["contain-intrinsic-size", "10px 20px", { "contain-intrinsic-width": "10px", "contain-intrinsic-height": "20px" }],
    ["contain-intrinsic-size", "none", { "contain-intrinsic-width": "none", "contain-intrinsic-height": "none" }],
    ["flex", "auto", { "flex-grow": "1", "flex-shrink": "1", "flex-basis": "auto" }],
    ["flex", "2 3", { "flex-grow": "2", "flex-shrink": "3", "flex-basis": "0%" }],
    ["flex", "2 3 10px", { "flex-grow": "2", "flex-shrink": "3", "flex-basis": "10px" }],
    ["flex", "10px 2 3", { "flex-grow": "2", "flex-shrink": "3", "flex-basis": "10px" }],
    [
      "grid-area",
      "1 / 2 / 3 / 4",
      { "grid-row-start": "1", "grid-column-start": "2", "grid-row-end": "3", "grid-column-end": "4" },
    ],
    [
      "grid-area",
      "span 2 / a",
      { "grid-row-start": "span 2", "grid-column-start": "a", "grid-row-end": "auto", "grid-column-end": "a" },
    ],
    ["text-box", "normal", { "text-box-trim": "none", "text-box-edge": "auto" }],
    ["text-box", "trim-start", { "text-box-trim": "trim-start", "text-box-edge": "auto" }],
    ["text-box", "cap alphabetic", { "text-box-trim": "trim-both", "text-box-edge": "cap alphabetic" }],
    ["text-box", "trim-end text", { "text-box-trim": "trim-end", "text-box-edge": "text" }],
    [
      "-webkit-border-before",
      "1px solid red",
      {
        "-webkit-border-before-width": "1px",
        "-webkit-border-before-style": "solid",
        "-webkit-border-before-color": "red",
      },
    ],
    [
      "-webkit-border-before",
      "dashed",
      {
        "-webkit-border-before-width": "medium",
        "-webkit-border-before-style": "dashed",
        "-webkit-border-before-color": "currentcolor",
      },
    ],
  ])("%s: %s", (family, value, expected) => {
    expect(splitOf(family, value)).toEqual(expected);
  });

  test.each([
    ["marker", "none none"],
    ["marker", "red"],
    ["white-space", "wrap wrap"],
    ["white-space", "pre nowrap"],
    ["font-synthesis", "weight weight"],
    ["font-synthesis", "bold"],
    ["-webkit-text-stroke", "1px 2px"],
    ["-webkit-text-stroke", "red blue"],
    ["-webkit-text-stroke", "1px red blue"],
    ["contain-intrinsic-size", "auto"],
    ["contain-intrinsic-size", "10px 20px 30px"],
    ["contain-intrinsic-size", "red"],
    ["flex", "1 2 3"],
    ["flex", "10px 20px"],
    ["flex", "bogus"],
    ["grid-area", "a / b / c / d / e"],
    ["grid-area", "span"],
    ["grid-area", "span 2 3"],
    ["text-box", "trim-start trim-end"],
    ["text-box", "cap trim-both alphabetic"],
    ["text-box", "text text text"],
    ["-webkit-border-before", "1px 2px"],
    ["-webkit-border-before", "solid dashed"],
    ["-webkit-border-before", "1px solid red blue"],
  ])("%s refuses %s", (family, value) => {
    expect(splitOf(family, value)).toBeUndefined();
  });
});

describe("a position, split by hand", () => {
  const bg = (value: string) => splitOf("background-position", value);
  test.each([
    ["center", "center", "center"],
    ["top", "center", "top"],
    ["left", "left", "center"],
    ["10px", "10px", "center"],
    ["bottom right", "right", "bottom"],
    ["10px top", "10px", "top"],
    ["left 10px top 5px", "left 10px", "top 5px"],
    ["top 5px left 10px", "left 10px", "top 5px"],
    ["left 10px top", "left 10px", "top"],
    ["center top 5px", "center", "top 5px"],
    ["0 0, left top", "0, left", "0, top"],
  ])("background-position: %s", (value, x, y) => {
    expect(bg(value)).toEqual({ "background-position-x": x, "background-position-y": y });
  });

  test.each([
    "left right",
    "top bottom",
    "10px left",
    "5 5",
    "1px,",
    "a, , b",
    "left 10px 20px",
    "center 10px top",
    "red",
    "1 2 3 4 5",
    "left top 5px bottom",
  ])("background-position refuses %s", (value) => {
    expect(bg(value)).toBeUndefined();
  });

  test("a calc() holds its own commas, and two edges on one axis are no position", () => {
    expect(bg("calc(1px + 2%) 0, 3px 4px")).toEqual({
      "background-position-x": "calc(1px + 2%), 3px",
      "background-position-y": "0, 4px",
    });
    expect(bg("left 10px right 5px")).toBeUndefined();
    expect(splitOf("-webkit-mask-position", "10px 20px")).toEqual({
      "-webkit-mask-position-x": "10px",
      "-webkit-mask-position-y": "20px",
    });
  });

  test("a mask takes no three-value form, and is written with the prefixed names every engine has", () => {
    expect(splitOf("mask-position", "left 10px top")).toBeUndefined();
    expect(splitOf("mask-position", "right 3px bottom 1px")).toEqual({
      "-webkit-mask-position-x": "right 3px",
      "-webkit-mask-position-y": "bottom 1px",
    });
  });
});

describe("background, split by hand", () => {
  const bg = (value: string) => splitOf("background", value);

  test("one layer, every part", () => {
    expect(bg("url(a.png) left 10px top 5px / 10px 20px no-repeat fixed content-box padding-box red")).toEqual({
      "background-image": "url(a.png)",
      "background-position-x": "left 10px",
      "background-position-y": "top 5px",
      "background-size": "10px 20px",
      "background-repeat": "no-repeat",
      "background-attachment": "fixed",
      "background-origin": "content-box",
      "background-clip": "padding-box",
      "background-color": "red",
    });
  });

  test("two layers, the colour from the last, and one box sets both origin and clip", () => {
    expect(bg("linear-gradient(red, blue) center/cover, url(b.png) repeat-x border-box #abc")).toEqual({
      "background-image": "linear-gradient(red, blue), url(b.png)",
      "background-position-x": "center, 0%",
      "background-position-y": "center, 0%",
      "background-size": "cover, auto",
      "background-repeat": "repeat, repeat-x",
      "background-attachment": "scroll, scroll",
      "background-origin": "padding-box, border-box",
      "background-clip": "border-box, border-box",
      "background-color": "#abc",
    });
  });

  test.each([
    "red, blue",
    "url(a.png) url(b.png)",
    "bogus",
    "center / 10px 20px 30px",
    "url(a.png) / cover",
    "left right",
    "center /",
    "border-box border-box border-box",
    "fixed local",
    "a, , b",
  ])("refuses %s", (value) => {
    expect(bg(value)).toBeUndefined();
  });
});

describe("mask, split by hand", () => {
  const mask = (value: string) => splitOf("mask", value);
  const resets = {
    "mask-border-source": "initial",
    "mask-border-slice": "initial",
    "mask-border-width": "initial",
    "mask-border-outset": "initial",
    "mask-border-repeat": "initial",
  };

  test("one layer, every part, and the mask-border longhands WebKit's mask resets", () => {
    expect(mask("url(a.png) right 3px bottom 1px / contain no-repeat content-box no-clip subtract luminance")).toEqual({
      "mask-image": "url(a.png)",
      "-webkit-mask-position-x": "right 3px",
      "-webkit-mask-position-y": "bottom 1px",
      "mask-size": "contain",
      "mask-repeat": "no-repeat",
      "mask-origin": "content-box",
      "mask-clip": "no-clip",
      "mask-composite": "subtract",
      "mask-mode": "luminance",
      ...resets,
    });
  });

  test("two layers, and no-clip alone leaves the origin where it was", () => {
    expect(mask("none, url(b.png) no-clip")).toEqual({
      "mask-image": "none, url(b.png)",
      "-webkit-mask-position-x": "0%, 0%",
      "-webkit-mask-position-y": "0%, 0%",
      "mask-size": "auto, auto",
      "mask-repeat": "repeat, repeat",
      "mask-origin": "border-box, border-box",
      "mask-clip": "border-box, no-clip",
      "mask-composite": "add, add",
      "mask-mode": "match-source, match-source",
      ...resets,
    });
  });

  test.each([
    "url(a.png) red",
    "url(a.png) left 10px top",
    "url(a.png) margin-box",
    "url(a.png) fill-box",
    "url(a.png) no-clip no-clip",
    "url(a.png) content-box padding-box no-clip",
    "url(a.png) add add",
    "url(a.png) fixed",
  ])("refuses %s", (value) => {
    expect(mask(value)).toBeUndefined();
  });
});

describe("font, split by hand", () => {
  const font = (value: string) => splitOf("font", value);

  test("every part, and every longhand it only resets", () => {
    expect(font("italic small-caps bold condensed 16px/2 'Helvetica Neue', Arial, sans-serif")).toMatchObject({
      "font-style": "italic",
      "font-variant-caps": "small-caps",
      "font-weight": "bold",
      "font-stretch": "condensed",
      "font-size": "16px",
      "line-height": "2",
      "font-family": "'Helvetica Neue', Arial, sans-serif",
      "font-kerning": "auto",
      "font-size-adjust": "none",
      "font-variant-numeric": "normal",
    });
  });

  test("the smallest, with the rest at what font resets them to", () => {
    expect(font("12px serif")).toMatchObject({
      "font-style": "normal",
      "font-weight": "normal",
      "font-size": "12px",
      "line-height": "normal",
      "font-family": "serif",
    });
    expect(font("oblique 10deg 12px serif")?.["font-style"]).toBe("oblique 10deg");
    expect(font("600 12px serif")?.["font-weight"]).toBe("600");
  });

  test.each([
    "caption",
    "menu",
    "12px",
    "serif",
    "bold serif",
    "12px/ serif",
    "12px, serif",
    "12px serif,",
    "italic italic 12px serif",
    "normal normal normal normal normal 12px serif",
    "12px 1.5 serif",
    "12px/red serif",
    "12px inherit",
  ])("refuses %s", (value) => {
    expect(font(value)).toBeUndefined();
  });
});
