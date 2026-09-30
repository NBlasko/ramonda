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

/**
 * A range — `animation-range`, and both ranges of `timeline-trigger`.
 *
 * The positional table read `animation-range: cover` as a start alone, with the end at `normal`,
 * and `cover 10%` as a start and an end. Measured in Chromium and WebKit, the two with it: an end
 * left out is the start's RANGE NAME, and a length after a name is that name's offset —
 * `cover 10%` is `cover 10%` to `cover`.
 */
describe("a range, split by hand", () => {
  test.each([
    ["cover", "cover", "cover"],
    ["cover 10%", "cover 10%", "cover"],
    ["20%", "20%", "normal"],
    ["cover contain", "cover", "contain"],
    ["cover 10% contain 90%", "cover 10%", "contain 90%"],
    ["10% 90%", "10%", "90%"],
    ["normal", "normal", "normal"],
    ["entry 10% exit", "entry 10%", "exit"],
  ])("animation-range: %s", (value, start, end) => {
    expect(splitOf("animation-range", value)).toEqual({ "animation-range-start": start, "animation-range-end": end });
  });

  test("a list, item by item", () => {
    expect(splitOf("animation-range", "cover, 10% 90%")).toEqual({
      "animation-range-start": "cover, 10%",
      "animation-range-end": "cover, 90%",
    });
  });

  test.each(["bogus", "10% 20% 30%", "cover contain entry", "cover, "])("refuses %s", (value) => {
    expect(splitOf("animation-range", value)).toBeUndefined();
  });
});

describe("timeline-trigger, split by hand", () => {
  const trigger = (value: string) => splitOf("timeline-trigger", value);

  test("every part, and the active range after the slash", () => {
    expect(trigger("--a view() entry 10% exit / contain")).toEqual({
      "timeline-trigger-name": "--a",
      "timeline-trigger-source": "view()",
      "timeline-trigger-activation-range-start": "entry 10%",
      "timeline-trigger-activation-range-end": "exit",
      "timeline-trigger-active-range-start": "contain",
      "timeline-trigger-active-range-end": "contain",
    });
  });

  test("a name alone, and a list", () => {
    expect(trigger("--a, none")).toEqual({
      "timeline-trigger-name": "--a, none",
      "timeline-trigger-source": "auto, auto",
      "timeline-trigger-activation-range-start": "normal, normal",
      "timeline-trigger-activation-range-end": "normal, normal",
      "timeline-trigger-active-range-start": "auto, auto",
      "timeline-trigger-active-range-end": "auto, auto",
    });
    expect(trigger("--a / 10%")?.["timeline-trigger-active-range-end"]).toBe("auto");
  });

  test.each(["view() --a", "a", "--a --b --c", "--a view() /", "--a view() cover / contain / exit", "--a, "])(
    "refuses %s",
    (value) => {
      expect(trigger(value)).toBeUndefined();
    },
  );
});

describe("grid-template, grid and mask-border, split by hand", () => {
  test("the areas form: names that meet between two rows are one set, and a row with no size is auto", () => {
    expect(splitOf("grid-template", '[x] "a b" 10px [y] [z] "c d" / [p] 1fr [q] 2fr')).toEqual({
      "grid-template-rows": "[x] 10px [y z] auto",
      "grid-template-columns": "[p] 1fr [q] 2fr",
      "grid-template-areas": '"a b" "c d"',
    });
    expect(splitOf("grid-template", '"a" [e]')).toEqual({
      "grid-template-rows": "auto [e]",
      "grid-template-columns": "none",
      "grid-template-areas": '"a"',
    });
  });

  test("rows and columns across a slash, either side none", () => {
    expect(splitOf("grid-template", "none / 10px")).toEqual({
      "grid-template-rows": "none",
      "grid-template-columns": "10px",
      "grid-template-areas": "none",
    });
    expect(splitOf("grid-template", "none")).toEqual({
      "grid-template-rows": "none",
      "grid-template-columns": "none",
      "grid-template-areas": "none",
    });
  });

  test("grid: auto-flow on either side, and the template form with the implicit grid reset", () => {
    expect(splitOf("grid", "10px / dense auto-flow 20px")).toEqual({
      "grid-template-rows": "10px",
      "grid-template-columns": "none",
      "grid-template-areas": "none",
      "grid-auto-flow": "column dense",
      "grid-auto-rows": "auto",
      "grid-auto-columns": "20px",
    });
    expect(splitOf("grid", "auto-flow / 1fr")?.["grid-auto-flow"]).toBe("row");
    expect(splitOf("grid", '"a" 10px / 1fr')).toMatchObject({ "grid-template-areas": '"a"', "grid-auto-flow": "row" });
  });

  test("mask-border: a slice with its width and outset, and the defaults", () => {
    expect(splitOf("mask-border", "url(a.png) fill 30 / 10px / 2px round space")).toEqual({
      "mask-border-source": "url(a.png)",
      "mask-border-slice": "fill 30",
      "mask-border-width": "10px",
      "mask-border-outset": "2px",
      "mask-border-repeat": "round space",
    });
    expect(splitOf("mask-border", "url(a.png) 30 / / 2px")?.["mask-border-outset"]).toBe("2px");
    expect(splitOf("mask-border", "none")?.["mask-border-slice"]).toBe("0");
  });

  test.each([
    ["grid-template", '"a b" "c"'],
    ["grid-template", '"a a" "b a"'],
    ["grid-template", '"a$"'],
    ["grid-template", '""'],
    ["grid-template", "10px"],
    ["grid-template", "10px / 20px / 30px"],
    ["grid-template", "[a] [b] 10px / 1fr"],
    ["grid-template", '[x] [y] "a"'],
    ["grid-template", '"a" 10px 20px'],
    ["grid-template", '"a" / repeat(auto-fill, 10px)'],
    ["grid-template", '"a" repeat(2, 1fr)'],
    ["grid-template", '"a" "b'],
    ["grid-template", "(10px / 1fr"],
    ["grid-template", "10px) / 1fr"],
    ["grid", "auto-flow"],
    ["grid", "auto-flow / auto-flow"],
    ["grid", "10px / auto-flow dense dense"],
    ["grid", "10px / 20px auto-flow"],
    ["grid", "10px / 20px / auto-flow"],
    ["grid", "10px"],
    ["mask-border", "url(a.png) 30 /"],
    ["mask-border", "url(a.png) 30 / 10px /"],
    ["mask-border", "url(a.png) 30 fill fill"],
    ["mask-border", "url(a.png) 30 fill 40"],
    ["mask-border", "url(a.png) 1 2 3 4 5"],
    ["mask-border", "bogus"],
  ])("%s refuses %s", (family, value) => {
    expect(splitOf(family, value)).toBeUndefined();
  });
});

describe("the families the must-split list found, split by hand", () => {
  test.each([
    ["grid-column", "2", { "grid-column-start": "2", "grid-column-end": "auto" }],
    ["grid-column", "a", { "grid-column-start": "a", "grid-column-end": "a" }],
    ["grid-column", "1 / -1", { "grid-column-start": "1", "grid-column-end": "-1" }],
    ["grid-row", "span 2", { "grid-row-start": "span 2", "grid-row-end": "auto" }],
    [
      "border-radius",
      "1px 2px 3px 4px / 5px",
      {
        "border-top-left-radius": "1px 5px",
        "border-top-right-radius": "2px 5px",
        "border-bottom-right-radius": "3px 5px",
        "border-bottom-left-radius": "4px 5px",
      },
    ],
    [
      "border-radius",
      "1px 2px 3px",
      {
        "border-top-left-radius": "1px",
        "border-top-right-radius": "2px",
        "border-bottom-right-radius": "3px",
        "border-bottom-left-radius": "2px",
      },
    ],
    ["overscroll-behavior", "auto none", { "overscroll-behavior-x": "auto", "overscroll-behavior-y": "none" }],
    ["place-items", "first baseline", { "align-items": "first baseline", "justify-items": "first baseline" }],
    ["place-items", "center legacy right", { "align-items": "center", "justify-items": "legacy right" }],
    ["place-self", "safe start", { "align-self": "safe start", "justify-self": "safe start" }],
    ["place-content", "center space-between", { "align-content": "center", "justify-content": "space-between" }],
    ["columns", "2", { "column-width": "auto", "column-count": "2", "column-height": "auto", "column-wrap": "auto" }],
    [
      "columns",
      "200px 3",
      { "column-width": "200px", "column-count": "3", "column-height": "auto", "column-wrap": "auto" },
    ],
    ["container", "a b / size", { "container-name": "a b", "container-type": "size" }],
    ["container", "none", { "container-name": "none", "container-type": "normal" }],
    [
      "text-decoration",
      "underline overline dotted 2px red",
      {
        "text-decoration-line": "underline overline",
        "text-decoration-style": "dotted",
        "text-decoration-thickness": "2px",
        "text-decoration-color": "red",
      },
    ],
    ["text-emphasis", "filled circle red", { "text-emphasis-style": "filled circle", "text-emphasis-color": "red" }],
    ["text-emphasis", "red", { "text-emphasis-style": "none", "text-emphasis-color": "red" }],
    ["interest-delay", "1s", { "interest-delay-start": "1s", "interest-delay-end": "1s" }],
  ])("%s: %s", (family, value, expected) => {
    expect(splitOf(family, value)).toEqual(expected);
  });

  test("offset: none by hand, and the rest by its grammar", () => {
    expect(splitOf("offset", "none")?.["offset-path"]).toBe("none");
    expect(splitOf("offset", "path('M0 0 L10 10')")).toBeDefined();
  });

  test.each([
    ["grid-row", "0"],
    ["grid-row", "span 0"],
    ["grid-column", "span -1"],
    ["grid-column", "1 / 2 / 3"],
    ["grid-area", "0 / 1"],
    ["border-radius", "-1px"],
    ["border-radius", "1px 2px 3px 4px 5px"],
    ["border-radius", "1px / 2px / 3px"],
    ["border-radius", "1px /"],
    ["overscroll-behavior", "scroll"],
    ["overscroll-behavior", "auto auto auto"],
    ["place-items", "legacy left"],
    ["place-items", "anchor-center"],
    ["place-items", "space-between"],
    ["place-items", "a b c"],
    ["place-self", "legacy"],
    ["place-content", "first baseline"],
    ["place-content", "left"],
    ["columns", "2 3"],
    ["columns", "200px 300px"],
    ["columns", "1.5"],
    ["columns", "10%"],
    ["columns", "a b c"],
    ["container", "card / bogus"],
    ["container", "card / size / x"],
    ["container", "and"],
    ["container", ""],
    ["text-decoration", "none underline"],
    ["text-decoration", "underline underline"],
    ["text-decoration", "spelling-error underline"],
    ["text-decoration", "bogus"],
    ["text-emphasis", "circle circle"],
    ["text-emphasis", "'x' dot"],
    ["text-emphasis", "bogus"],
    ["interest-delay", "1s 2s 3s"],
    ["interest-delay", "red"],
  ])("%s refuses %s", (family, value) => {
    expect(splitOf(family, value)).toBeUndefined();
  });
});

/**
 * A value one engine does not have yet — `partial` on a grammar shape, measured by the generator.
 * `text-wrap: pretty` is taken by Chromium and WebKit and refused by Firefox, which then drops the
 * whole declaration; a split would still set `text-wrap-mode` there. So it keeps its shorthand —
 * and it is NOT an error, the way `animation: auto` is: the engines do not read it differently, one
 * of them simply does not have it, which is what an author writing it expects.
 */
describe("a value one engine does not have", () => {
  test("keeps its shorthand", () => {
    expect(splitOf("text-wrap", "pretty")).toBeUndefined();
    expect(splitOf("text-wrap", "nowrap pretty")).toBeUndefined();
    expect(splitOf("text-wrap", "balance")).toBeDefined();
  });
});

describe("offset and border-image, split by hand", () => {
  test.each([
    [
      "none",
      {
        "offset-position": "normal",
        "offset-path": "none",
        "offset-distance": "0px",
        "offset-rotate": "auto",
        "offset-anchor": "auto",
      },
    ],
    [
      "10px 30px",
      {
        "offset-position": "10px 30px",
        "offset-path": "none",
        "offset-distance": "0px",
        "offset-rotate": "auto",
        "offset-anchor": "auto",
      },
    ],
    [
      "url(a.svg) 10% auto 90deg / left top",
      {
        "offset-position": "normal",
        "offset-path": "url(a.svg)",
        "offset-distance": "10%",
        "offset-rotate": "auto 90deg",
        "offset-anchor": "left top",
      },
    ],
    [
      "url(a.svg) 30deg",
      {
        "offset-position": "normal",
        "offset-path": "url(a.svg)",
        "offset-distance": "0px",
        "offset-rotate": "30deg",
        "offset-anchor": "auto",
      },
    ],
  ])("offset: %s", (value, expected) => {
    expect(splitOf("offset", value)).toEqual(expected);
  });

  test("border-image, with its own initial values", () => {
    expect(splitOf("border-image", "url(a.png) 27 23 / 50px 30px / 1rem round space")).toEqual({
      "border-image-source": "url(a.png)",
      "border-image-slice": "27 23",
      "border-image-width": "50px 30px",
      "border-image-outset": "1rem",
      "border-image-repeat": "round space",
    });
    expect(splitOf("border-image", "none")).toEqual({
      "border-image-source": "none",
      "border-image-slice": "100%",
      "border-image-width": "1",
      "border-image-outset": "0",
      "border-image-repeat": "stretch",
    });
  });

  test.each([
    ["offset", "/ 10px"],
    ["offset", "url(a.svg) 30deg 30deg"],
    ["offset", "url(a.svg) 10px 20px"],
    ["offset", "url(a.svg) / 1 / 2"],
    ["offset", "path('M0 0') / bogus"],
    ["offset", "bogus"],
    ["border-image", "url(a.png) 10 /"],
    ["border-image", "url(a.png) 1 2 3 4 5"],
  ])("%s refuses %s", (family, value) => {
    expect(splitOf(family, value)).toBeUndefined();
  });
});

describe("what the review found in the splitter", () => {
  test("a CSS-wide keyword in any case refuses a mixed value, as the browser does", () => {
    expect(splitOf("margin", "1px INHERIT")).toBeUndefined();
    expect(splitOf("flex", "1 Initial")).toBeUndefined();
  });

  test("a slash or a comma inside a quoted font name is the name's own", () => {
    expect(splitOf("font", '12px "A/B", serif')?.["font-family"]).toBe('"A/B", serif');
    expect(splitOf("font", "12px 'A, B'")?.["font-family"]).toBe("'A, B'");
  });

  test("a custom function or attr() is as unknown as a var(), and keeps the shorthand", () => {
    expect(splitOf("padding", "--pad()")).toBeUndefined();
    expect(splitOf("padding", "1px --gap(2)")).toBeUndefined();
    expect(splitOf("margin", "attr(data-m type(<length>))")).toBeUndefined();
  });
});

/**
 * A keyword in any case, where the property also takes names of the author's own. The compiler
 * folds a keyword's case only for a property with a closed list, so `grid-column: SPAN 2` reached
 * the splitter as written, matched no rule, and stayed whole — every engine takes it, since CSS
 * keywords ignore case. The third review found it; a name of the author's keeps its case.
 */
describe("a keyword in any case, beside names", () => {
  test.each([
    ["grid-column", "SPAN 2", { "grid-column-start": "span 2", "grid-column-end": "auto" }],
    [
      "grid-area",
      "Auto",
      { "grid-row-start": "auto", "grid-column-start": "auto", "grid-row-end": "auto", "grid-column-end": "auto" },
    ],
    ["container", "card / Inline-Size", { "container-name": "card", "container-type": "inline-size" }],
  ])("%s: %s", (family, value, expected) => {
    expect(splitOf(family, value)).toEqual(expected);
  });

  test("font: BOLD 12px serif splits", () => {
    expect(splitOf("font", "BOLD 12px serif")?.["font-weight"]).toBe("bold");
  });

  test("a grid line NAME in brackets keeps its case, though it is spelled like a keyword", () => {
    expect(splitOf("grid", "[Dense] 10px / auto-flow")?.["grid-template-rows"]).toBe("[Dense] 10px");
    expect(splitOf("grid-template", "[None] 10px / [Min-Content] auto")).toEqual({
      "grid-template-rows": "[None] 10px",
      "grid-template-columns": "[Min-Content] auto",
      "grid-template-areas": "none",
    });
    // Outside the brackets the same word is a keyword, and is folded.
    expect(splitOf("grid-template", "[a] MIN-CONTENT / auto")?.["grid-template-rows"]).toBe("[a] min-content");
  });

  test("a name of the author's keeps its case", () => {
    expect(splitOf("container", "Size / size")).toEqual({ "container-name": "Size", "container-type": "size" });
    expect(splitOf("grid-area", "Header")?.["grid-row-start"]).toBe("Header");
  });
});

/**
 * What `check-must-split.mjs` found once every family that splits was put on it. Each of these
 * reached the sheet whole, or split where a browser drops the declaration.
 */
describe("what the must-split list found in every family", () => {
  test("scroll-margin takes no percentage, and still splits a value of two lengths", () => {
    expect(splitOf("scroll-margin", "0 8px")).toEqual({
      "scroll-margin-top": "0",
      "scroll-margin-right": "8px",
      "scroll-margin-bottom": "0",
      "scroll-margin-left": "8px",
    });
    expect(splitOf("scroll-margin-block", "4px -8px")).toEqual({
      "scroll-margin-block-start": "4px",
      "scroll-margin-block-end": "-8px",
    });
  });

  test("a percentage where the family refuses one keeps the shorthand; where it takes one, splits", () => {
    expect(splitOf("scroll-margin", "10% 5px")).toBeUndefined();
    expect(splitOf("scroll-margin", "calc(1px + 2%)")).toBeUndefined();
    expect(splitOf("margin", "10% 5px")?.["margin-top"]).toBe("10%");
    // A colour family is never asked: `rgb(10% 0% 0%)` is a colour, not a percentage.
    expect(splitOf("border-color", "rgb(10% 0% 0%) blue")?.["border-top-color"]).toBe("rgb(10% 0% 0%)");
  });

  test("position-try splits a list of fallbacks, with the order on the first item only", () => {
    expect(splitOf("position-try", "--a, --b")).toEqual({
      "position-try-order": "initial",
      "position-try-fallbacks": "--a, --b",
    });
    expect(splitOf("position-try", "most-width --a, --b")).toEqual({
      "position-try-order": "most-width",
      "position-try-fallbacks": "--a, --b",
    });
    expect(splitOf("position-try", "--a, most-width --b")).toBeUndefined();
    expect(splitOf("position-try", "none, --a")).toBeUndefined();
    expect(splitOf("position-try", "--a, none")).toBeUndefined();
  });

  test.each([
    ["transition", "1s,"],
    ["transition", ",1s"],
    ["transition", "1s,,2s"],
    ["animation", "a 1s,"],
    ["padding", "1px,"],
    ["position-try", "--a,"],
  ])("an empty item is invalid CSS and keeps the shorthand — %s: %s", (family, value) => {
    expect(splitOf(family, value)).toBeUndefined();
  });

  test("a comma in a quote or a function is not an item", () => {
    expect(splitOf("font", '12px "a,"')?.["font-family"]).toBe('"a,"');
    expect(splitOf("transition", "opacity cubic-bezier(0,0,1,1)")?.["transition-property"]).toBe("opacity");
  });
});
