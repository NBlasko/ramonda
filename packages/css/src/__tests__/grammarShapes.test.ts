import { describe, expect, test } from "vitest";
import { splitByGrammar, splitOf } from "../compiler/split";
import { BY_HAND } from "../compiler/splitByHand";
import { SHORTHANDS } from "../compiler/keywords.generated";
import { SHAPES } from "../compiler/shapes.generated";
import { GRAMMAR_SHAPES } from "../compiler/grammarShapes.generated";

/**
 * Splitting through the GENERATED table — the grammar the engines agreed on, read by the splitter.
 *
 * Whether a split produces the same page is answered where it can be: inside
 * `scripts/build-grammar-shapes.mjs`, which reproduces every family's own corpus in Chromium,
 * Firefox and WebKit before writing a row. These are the questions no browser answers — what the
 * function does with a value it must REFUSE, and that it reads the table rather than guessing.
 *
 * `splitByGrammar.test.ts` asks the same function about shapes written out by hand, where what is
 * asserted is the machine. Here the shape comes from the table, so what is asserted is the door.
 */

const shapeOf = (name: string) => {
  const shape = GRAMMAR_SHAPES[name];
  if (shape === undefined) throw new Error(`no shape for ${name} — regenerate the table`);
  return shape;
};

describe("a value written in any order", () => {
  test("each token finds its own longhand", () => {
    expect(splitByGrammar(shapeOf("border-top"), "1px solid red")).toEqual({
      "border-top-width": "1px",
      "border-top-style": "solid",
      "border-top-color": "red",
    });
  });

  test("and the order it was written in does not matter", () => {
    expect(splitByGrammar(shapeOf("border-top"), "red 1px solid")).toEqual(
      splitByGrammar(shapeOf("border-top"), "1px solid red"),
    );
  });

  /** Every longhand the shorthand resets is written, which is what makes the split equivalent. */
  test("a longhand no token reached is reset, not left out", () => {
    expect(splitByGrammar(shapeOf("border-top"), "solid")).toEqual({
      "border-top-width": "initial",
      "border-top-style": "solid",
      "border-top-color": "initial",
    });
  });

  test("a colour is recognised as a call, a hex and a name alike", () => {
    for (const colour of ["rgb(1 2 3)", "#abcdef", "rebeccapurple"])
      expect(splitByGrammar(shapeOf("border-top"), colour)?.["border-top-color"]).toBe(colour);
  });

  test("a length is recognised by its unit, not by a list of values", () => {
    expect(splitByGrammar(shapeOf("border-top"), "2.5rem")?.["border-top-width"]).toBe("2.5rem");
  });
});

/**
 * `list-style-type` takes a `custom-ident`, so it says yes to nearly any word — and it also lists
 * `none` exactly, and it is named BEFORE `list-style-image`. Three ways to get it wrong, and the
 * table carries all three in one family.
 */
describe("an open leaf", () => {
  test("takes a word it lists exactly, before any other leaf sees it", () => {
    expect(splitByGrammar(shapeOf("list-style"), "none")?.["list-style-type"]).toBe("none");
  });

  test("and leaves a call alone, because a call is no identifier", () => {
    expect(splitByGrammar(shapeOf("list-style"), "url(a.png) inside")).toEqual({
      "list-style-type": "initial",
      "list-style-position": "inside",
      "list-style-image": "url(a.png)",
    });
  });

  test("and a word nothing else claims lands in it", () => {
    expect(splitByGrammar(shapeOf("list-style"), "upper-roman")?.["list-style-type"]).toBe("upper-roman");
  });
});

describe("what it refuses, so the shorthand stays whole", () => {
  test("a `var()`, whose contents no table can know", () => {
    expect(splitByGrammar(shapeOf("border-top"), "var(--edge)")).toBeUndefined();
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
    expect(splitByGrammar(shapeOf("list-style"), "square, inside")).toBeUndefined();
  });

  test("a slash, likewise", () => {
    expect(splitByGrammar(shapeOf("list-style"), "square/inside")).toBeUndefined();
  });

  test("an empty value", () => {
    expect(splitByGrammar(shapeOf("border-top"), "   ")).toBeUndefined();
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
    expect(splitByGrammar(shapeOf("text-decoration"), "underline overline")).toBeUndefined();
  });

  /**
   * A comma INSIDE a call is not a separator, and refusing it turned away most real colours.
   *
   * The guard read the whole text, so `rgb(1 2 3)` split and `rgb(1, 2, 3)` did not — and the
   * legacy comma spelling is what almost every codebase writes. It was invisible because the
   * generator's corpus samples a colour as `rgb(1 2 3)`.
   */
  test.each(["1px solid rgb(1, 2, 3)", "1px solid rgba(1, 2, 3, .5)", "1px solid color-mix(in srgb, red, blue)"])(
    "%s splits, because the commas are inside a call",
    (value) => {
      expect(splitByGrammar(shapeOf("border-top"), value)?.["border-top-width"]).toBe("1px");
    },
  );

  /**
   * A `--name` is a DASHED-IDENT, and nothing recognised one.
   *
   * `scroll-timeline: --carousel block` names a timeline, which is the ordinary way to write the
   * family — and the token matched no slot, so the whole value was refused. The generator wrote the
   * shape anyway, because it only ever checks values that SPLIT and this one was among the refused.
   * The refusal count is what made it visible.
   */
  test("a dashed identifier is recognised as one", () => {
    expect(splitByGrammar(shapeOf("scroll-timeline"), "--carousel block")).toEqual({
      "scroll-timeline-name": "--carousel",
      "scroll-timeline-axis": "block",
    });
  });

  test("a token no slot will take", () => {
    expect(splitByGrammar(shapeOf("border-top"), "1px solid red 9px 8px")).toBeUndefined();
  });

  /** A unit CSS does not have makes the token nothing, and nothing is not a width. */
  test("a number carrying a unit no primitive claims", () => {
    expect(splitByGrammar(shapeOf("border-top"), "5zz")).toBeUndefined();
  });

  test("a bare number, which is not a length either", () => {
    expect(splitByGrammar(shapeOf("border-top"), "5")).toBeUndefined();
  });

  /** A call this family does not take is refused rather than dropped into whatever is free. */
  test("a function no slot lists", () => {
    expect(splitByGrammar(shapeOf("border-top"), "steps(4)")).toBeUndefined();
  });
});

describe("a CSS-wide keyword is not a component value", () => {
  test("it goes on every longhand the family resets", () => {
    expect(splitByGrammar(shapeOf("border-top"), "inherit")).toEqual({
      "border-top-width": "inherit",
      "border-top-style": "inherit",
      "border-top-color": "inherit",
    });
  });

  /** CSS has no such form either, so refusing it is mirroring the language rather than giving up. */
  test("and beside another value it is refused", () => {
    expect(splitByGrammar(shapeOf("border-top"), "1px inherit")).toBeUndefined();
  });
});

/**
 * The boundary of the table, asserted so that widening it is a deliberate act.
 *
 * These families have a comma, a slash or a repetition in their grammar, so a value of theirs is
 * not a bag of tokens and no row was written. They keep their shorthand.
 */
/**
 * A split produces LEAVES, and nothing in between — which is what makes one derived layer enough.
 *
 * `border` → `border-width` → `border-top-width` is three levels, so the question is fair: if a
 * split could produce something that is ITSELF a shorthand, one layer for everything derived would
 * put two levels in the same shelf and the narrower one would stop winning.
 *
 * It cannot, and not by luck. The longhand list is what the ENGINE says the shorthand expands to,
 * and an engine always expands to leaves — measured, `border: inherit` lists `border-top-color`
 * directly and never `border-width`, and `grid` lists `grid-template-rows` and never
 * `grid-template`. This asserts the consequence rather than the reason, so a CSS that one day
 * behaves otherwise is heard here instead of in a page.
 */
describe("a split reaches leaves, never another shorthand", () => {
  test.each([...Object.keys(SHAPES), ...Object.keys(GRAMMAR_SHAPES)])("%s splits into leaves", (family) => {
    const shape = GRAMMAR_SHAPES[family];
    const longhands =
      shape !== undefined
        ? shape.longhands
        : Object.keys(SHAPES[family].patterns[Object.keys(SHAPES[family].patterns)[0] as string] ?? {});

    expect(longhands.filter((one) => (SHORTHANDS[one] ?? []).length > 0)).toEqual([]);
  });

  /**
   * And the families split BY HAND, whose longhands are written in code rather than read off an
   * engine — so this is the only thing standing between them and a shorthand among their pieces.
   * One value each that exercises every part.
   */
  const SAMPLES: Readonly<Record<string, string>> = {
    marker: "none",
    "white-space": "pre",
    "font-synthesis": "weight",
    "-webkit-text-stroke": "1px red",
    "contain-intrinsic-size": "auto 10px 20px",
    flex: "1 1 10px",
    "grid-area": "a / b / c / d",
    "text-box": "trim-both cap alphabetic",
    "-webkit-border-before": "1px solid red",
    background: "url(a.png) center / cover no-repeat fixed content-box padding-box red",
    mask: "url(a.png) center / cover no-repeat content-box no-clip subtract luminance",
    font: "italic small-caps bold condensed 12px/2 serif",
    "animation-range": "cover 10% contain 90%",
    "timeline-trigger": "--a view() cover / contain",
    "grid-template": '[x] "a" 10px / 1fr',
    grid: "10px / auto-flow 20px",
    "mask-border": "url(a.png) 30 / 10px / 2px round",
    "background-position": "left 10px top 5px",
    "mask-position": "left 10px top 5px",
    "-webkit-mask-position": "left 10px top 5px",
    "grid-row": "1 / span 2",
    "grid-column": "a",
    "border-radius": "1px 2px 3px 4px / 5px",
    "overscroll-behavior": "auto none",
    "place-items": "first baseline center",
    "place-self": "safe start end",
    "place-content": "center space-between",
    columns: "2 200px",
    container: "a b / size",
    "text-decoration": "underline overline dotted 2px red",
    "text-emphasis": "filled circle red",
    offset: "none",
    "interest-delay": "1s 2s",
  };

  test("every family split by hand has a sample here", () => {
    expect(Object.keys(BY_HAND).sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  test.each(Object.entries(SAMPLES))("%s, split by hand, splits into leaves", (family, value) => {
    const longhands = Object.keys(splitOf(family, value) ?? { none: "" });
    expect(longhands).not.toEqual(["none"]);
    expect(longhands.filter((one) => (SHORTHANDS[one] ?? []).length > 0)).toEqual([]);
  });
});

describe("the families this cannot answer are absent, not wrong", () => {
  test.each(["background", "mask", "font", "grid"])("%s has no shape", (name) => {
    expect(GRAMMAR_SHAPES[name]).toBeUndefined();
  });

  test("while the whole border family does", () => {
    for (const name of ["border", "border-top", "border-block", "border-inline-end"])
      expect(GRAMMAR_SHAPES[name]).toBeDefined();
  });

  /**
   * `animation` is IN, and one VALUE of it is out.
   *
   * Measured: `animation: auto` is `animation-name: auto` in Firefox and touches nothing in
   * Chromium or WebKit. No single split writes the same page in all three, so that value keeps its
   * shorthand — and every other value of the family splits, which refusing the whole family for it
   * used to cost.
   */
  test("and `animation` is in, with the one value the engines disagree about refused", () => {
    expect(GRAMMAR_SHAPES.animation?.contested).toEqual(["auto"]);
    expect(splitByGrammar(shapeOf("animation"), "auto")).toBeUndefined();
    expect(splitByGrammar(shapeOf("animation"), "spin 1s")).toMatchObject({
      "animation-name": "spin",
      "animation-duration": "1s",
    });
  });

  /** `animation-range-*` is outside `<single-animation>` entirely, so the list does not repeat it. */
  test("and a longhand the grammar never mentions is reset once", () => {
    expect(splitByGrammar(shapeOf("animation"), "spin 1s, slide 2s")).toMatchObject({
      "animation-name": "spin, slide",
      "animation-range-end": "initial",
    });
  });

  /** `transition` is IN, which no list of slots could manage: its two `<time>`s are one component
   * written twice, and which is the duration was measured rather than read. */
  test("while `transition` is in, with its two times told apart", () => {
    expect(GRAMMAR_SHAPES.transition).toBeDefined();
    expect(splitByGrammar(shapeOf("transition"), "1s")).toMatchObject({
      "transition-duration": "1s",
      "transition-delay": "0s",
    });
  });
});

/**
 * A comma-separated family: the same shape repeated, and each longhand a list of its own.
 *
 * `transition: color 1s, opacity 2s` is two items of one shape, and every longhand the family sets
 * takes a list the same length — `transition-property: color, opacity`. So the split is the bag of
 * one item's reading applied per item and joined back per longhand, which is why the list case is a
 * few lines inside `splitByGrammar` rather than a second splitter.
 */
describe("a comma-separated family", () => {
  test("a longhand no token reached is reset in the item that missed it", () => {
    expect(splitByGrammar(shapeOf("scroll-timeline"), "--a, --b inline")).toEqual({
      "scroll-timeline-name": "--a, --b",
      "scroll-timeline-axis": "block, inline",
    });
  });

  test("and where every item misses it, all of them carry the value", () => {
    expect(splitByGrammar(shapeOf("scroll-timeline"), "--a, --b")).toEqual({
      "scroll-timeline-name": "--a, --b",
      "scroll-timeline-axis": "block, block",
    });
  });

  /**
   * A longhand whose initial value the engines disagree about has none to write, and the family is
   * refused rather than given one engine's answer. No family in the table needs that today — every
   * name in `UNSTABLE` belongs to a family with no comma in it — so the case is asserted where a
   * shape can be written by hand, in `splitByGrammar.test.ts`.
   */

  test("a call keeps its own commas", () => {
    expect(splitByGrammar(shapeOf("transition"), "steps(1, end), steps(2, end)")).toMatchObject({
      "transition-timing-function": "steps(1, end), steps(2, end)",
    });
  });

  test("an item no shape can answer refuses the whole value", () => {
    expect(splitByGrammar(shapeOf("transition"), "1s, ??? ???")).toBeUndefined();
  });

  test("an empty item is refused rather than treated as a gap", () => {
    expect(splitByGrammar(shapeOf("transition"), "1s, , 2s")).toBeUndefined();
  });

  test("a CSS-wide keyword is the whole value, not an item of it", () => {
    expect(splitByGrammar(shapeOf("transition"), "inherit")?.["transition-duration"]).toBe("inherit");
  });

  /**
   * And as an item it is refused, which is what CSS does with it. Measured in all three engines:
   * `scroll-timeline: inherit, --b`, `--a, inherit` and `initial, --b` are each rejected outright.
   * Splitting one would write declarations for a value the browser never accepted.
   */
  test("and beside another item it is refused, as CSS refuses it", () => {
    expect(splitByGrammar(shapeOf("scroll-timeline"), "inherit, --b")).toBeUndefined();
    expect(splitByGrammar(shapeOf("scroll-timeline"), "--a, inherit")).toBeUndefined();
  });

  test("and a `var()` is refused, as everywhere else", () => {
    expect(splitByGrammar(shapeOf("transition"), "1s, var(--x)")).toBeUndefined();
  });
});
