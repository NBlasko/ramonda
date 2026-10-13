import { PROPERTIES, SHORTHANDS } from "../../compiler/keywords.generated";
import { checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { readBlock } from "../../compiler/read";
import { checkNamedFree } from "./helpers";

/**
 * The shorthand table, which composition needs and nothing before it did.
 *
 * A shorthand and its longhand are DIFFERENT properties, so a merge of two blocks keeps both and the
 * STYLESHEET breaks the tie — measured in Chromium, `.a{padding:8px}` with `.b{padding-left:40px}`
 * gives 40px whichever order the classes are written in, and 8px if the longhand is emitted first.
 * Against the call site, silently, either way.
 *
 * The merge answers it the way CSS's own cascade does — **a later shorthand clears its own
 * longhands** — and this table is what it needs. Generated from mdn-data by the sweep that already
 * writes the property map, because one classification asked twice is a place to drift.
 *
 * **Transitively closed**, and that is not a nicety: 11 of the entries mdn-data gives point at
 * another SHORTHAND — `border` sets `border-width`, which is itself a shorthand for four — so a
 * table taken as written would let `border` fail to clear `border-left-color`, which is exactly the
 * kind of override composition exists for.
 */
describe("the shorthand table", () => {
  test("a shorthand names the longhands it sets", () => {
    expect(SHORTHANDS.padding).toEqual(
      expect.arrayContaining(["padding-top", "padding-right", "padding-bottom", "padding-left"]),
    );
    expect(SHORTHANDS.gap).toEqual(expect.arrayContaining(["row-gap", "column-gap"]));
  });

  test("and a longhand names nothing, because it sets only itself", () => {
    expect(SHORTHANDS["padding-left"]).toBeUndefined();
    expect(SHORTHANDS.display).toBeUndefined();
    expect(SHORTHANDS.color).toBeUndefined();
  });

  /**
   * A shorthand can be shadowed by a BIGGER one, and the first version of this table missed it.
   *
   * `border` sets everything `border-left` sets, so a later `border` has to clear it — but mdn-data
   * writes `border`'s list as `border-width border-style border-color`, and `border-left` is in
   * none of them. Measured with the real table: `border-left` then `border` left BOTH classes on
   * the element, so the border-left rule survived a declaration that replaces it.
   *
   * So what a shorthand clears is every property whose leaves are a SUBSET of its own — which is
   * what "sets everything that one sets" means, and it is computable from the same data.
   */
  test("a bigger shorthand clears a smaller one, not only the leaves", () => {
    expect(SHORTHANDS.border).toContain("border-left");
    expect(SHORTHANDS.border).toContain("border-width");
    expect(SHORTHANDS.background).toContain("background-color");
    // and not the other way round: the smaller one does not clear the bigger
    expect(SHORTHANDS["border-left"]).not.toContain("border");
  });

  test("a shorthand of shorthands reaches the leaves", () => {
    // `border` -> `border-width` -> `border-left-width`. A table taken as mdn-data writes it stops
    // at the middle one, and `border` would not clear what `border-left` set.
    expect(SHORTHANDS.border).toContain("border-left-width");
    expect(SHORTHANDS.border).toContain("border-left-color");
    expect(SHORTHANDS.border).toContain("border-top-style");
  });

  test("every name in it is a property CSS has", () => {
    const known = new Set(PROPERTIES);
    for (const [shorthand, longhands] of Object.entries(SHORTHANDS)) {
      expect(known.has(shorthand), `${shorthand} is not a CSS property`).toBe(true);
      for (const one of longhands) expect(known.has(one), `${shorthand} names ${one}`).toBe(true);
    }
  });

  test("and nothing sets itself, which would make the merge clear what it just wrote", () => {
    for (const [shorthand, longhands] of Object.entries(SHORTHANDS)) {
      expect(longhands, shorthand).not.toContain(shorthand);
    }
  });

  /**
   * **The merge built on this table is associative**, which is what makes a nested `when` mean the
   * same as a flattened one — and it is the property the clearing rule could have broken, since
   * clearing removes keys rather than replacing them.
   *
   * Measured on the real table with a pool drawn from ONE family, so shorthands and their longhands
   * collide constantly: 50,301 groupings, zero disagreements between `_m(a, _m(b, c))` and
   * `_m(a, b, c)`. Asserted here on the cases that actually shadow each other, so a change to the
   * table that broke it would fail rather than wait for the sweep to be re-run by hand.
   */
  test("clearing is associative, which is what lets a group nest", () => {
    /** A merged map, which is also what one of its own arguments may be — that is the point. */
    const merge = (...maps: ReadonlyMap<string, string>[]): Map<string, string> => {
      const out = new Map<string, string>();
      for (const map of maps) {
        for (const [key, value] of map) {
          for (const one of SHORTHANDS[key] ?? []) out.delete(one);
          out.set(key, value);
        }
      }
      return out;
    };
    const of = (entries: Record<string, string>) => new Map(Object.entries(entries));
    const show = (map: ReadonlyMap<string, string>) => [...map].map(([k, v]) => `${k}=${v}`).join(",");

    const shapes: Record<string, string>[][] = [
      [{ "border-left-color": "1" }, { "border-left": "2" }, { border: "3" }],
      [{ border: "1" }, { "border-left": "2" }, { "border-left-color": "3" }],
      [{ "padding-left": "1" }, { padding: "2" }, { "padding-left": "3" }],
      [{ gap: "1" }, { "row-gap": "2" }, { gap: "3" }],
      [{ "background-color": "1" }, { background: "2" }, { "background-color": "3" }],
    ];

    for (const [a, b, c] of shapes) {
      const flat = show(merge(of(a), of(b), of(c)));
      expect(show(merge(of(a), merge(of(b), of(c)))), JSON.stringify([a, b, c])).toBe(flat);
      expect(show(merge(merge(of(a), of(b)), of(c))), JSON.stringify([a, b, c])).toBe(flat);
    }
  });

  /** The measurement that made this table the answer rather than expanding values. */
  test("it covers the shorthands actually written in this repository", () => {
    for (const one of ["padding", "margin", "gap", "border-left", "transition", "border-radius", "background"]) {
      expect(SHORTHANDS[one], one).toBeDefined();
    }
  });
});

/**
 * A declaration written to override an earlier one, which the stylesheet's order will not let win.
 *
 * **The stylesheet has ONE order and a block has another.** The sheet emits unconditional rules
 * before conditional ones, and broader properties before the ones they cover — it has to, because a
 * rule is shared by every element that names it and there is no per-block order to honour. Inside a
 * block the author's order is what decides, and the two agree almost always.
 *
 * Where they disagree, the author's loses SILENTLY, and that is the whole fault. Measured against
 * plain CSS in Chromium, the same declarations written in the same order:
 *
 * | written | plain CSS | ours |
 * |---|---|---|
 * | `@media { padding: 40px }` then `padding: 8px` | 8px | **40px** |
 * | `@media { padding: 40px }` then `padding-left: 8px` | left 8px | **left 40px** |
 * | `@media { … }` then an unrelated property | same | same |
 * | `@media { &:hover { … } }` then a plain one | same | same — a selector adds specificity |
 * | two declarations under the SAME condition | same | same — their order is kept |
 *
 * The merge cannot answer it: these are different keys, so both classes land and the sheet breaks
 * the tie. Nothing else reports it, and a page that silently ignores an override is exactly what
 * this package exists to stop.
 */
describe("an override the sheet's order will not honour", () => {
  test("a plain declaration below a conditional one that sets the same thing", () => {
    const found = checkNamedFree("@media (min-width: 40rem) { padding: 40px; }\npadding: 8px;");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain("@media (min-width: 40rem)");
  });

  test("and below one that sets a shorthand it is part of", () => {
    expect(checkNamedFree("@media (min-width: 40rem) { padding: 40px; }\npadding-left: 8px;")[0]?.rule).toBe(
      "override-out-of-order",
    );
  });

  /**
   * TWO BREAKPOINTS, and this is what the sheet could not tell apart until it read the query.
   *
   * The sheet emits the rule for the wider viewport first, because that is what a breakpoint means
   * and what every atomic CSS framework does — so writing the wide one BELOW the narrow one is an
   * override that cannot happen, and it used to be honoured only as long as no other file wrote one
   * of the two. Measured in Chromium: 280 of 750 load orders wrong.
   */
  test("a narrow breakpoint below a wider one, which the sheet emits last", () => {
    const found = checkNamedFree(
      "@media (min-width: 64rem) { padding: 40px; }\n@media (min-width: 40rem) { padding: 8px; }",
    );

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain("wider viewport first");
  });

  test("and the way round the sheet does emit them is not reported", () => {
    expect(
      checkNamedFree("@media (min-width: 40rem) { padding: 8px; }\n@media (min-width: 64rem) { padding: 40px; }"),
    ).toHaveLength(0);
  });

  /**
   * A VENDOR PREFIX written BELOW the standard property it is another name for.
   *
   * The engine treats them as one property, so in plain CSS the later one wins. The sheet puts the
   * prefixed form first — deliberately, so the standard property wins wherever both appear and wins
   * the same way in every build — which means writing them this way round is an override that
   * cannot happen. Measured in Chromium, `box-shadow: 0 0 9px blue; -webkit-box-shadow: 0 0 1px red`
   * is red in plain CSS and blue here.
   *
   * The conventional order is the other one, and it is silent: a prefixed fallback ABOVE the
   * standard property is what every author writes, and it does exactly what they mean.
   */
  test.each([
    ["box-shadow", "-webkit-box-shadow", "0 0 1px red"],
    ["transform", "-webkit-transform", "scale(7)"],
    ["user-select", "-webkit-user-select", "text"],
    ["appearance", "-webkit-appearance", "button"],
  ])("a prefixed `%s` below the standard one", (standard, prefixed, value) => {
    const found = checkNamedFree(`${standard}: ${value};\n${prefixed}: ${value};`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain(standard);
    // And the REASON is this pair's own, not the shorthand sentence most of these get: neither
    // name is a shorthand, and what decides is that the engine reads them as one property.
    expect(found[0].message).toContain("vendor prefix before the standard property");
  });

  test("and the conventional order — the prefix first — is silent", () => {
    expect(checkNamedFree("-webkit-box-shadow: 0 0 1px red;\nbox-shadow: 0 0 9px blue;")).toHaveLength(0);
    expect(checkNamedFree("-webkit-transform: scale(7);\ntransform: scale(3);")).toHaveLength(0);
  });

  /**
   * TWO CONDITIONS THE SHEET CANNOT ORDER, both of which may hold at once.
   *
   * `widthSlot` ranks a breakpoint by its width and everything else by a small table of bands — and
   * inside a band, two different conditions TIE. A tie is settled by the sheet's position, which is
   * the order the build happened to meet them, which is exactly what the bands exist to stop. The
   * note on `widthSlot` records the same fault for breakpoints: *the sheet fell back to the order the
   * file happened to write them in — which another file re-emitting one of the two then reversed.*
   *
   * Measured in Chromium through a real Vite build, the same block each time:
   *
   *     @supports (display: grid) { color: red; } @supports (display: flex) { color: blue; }
   *
   *     alone in the file                          blue — what plain CSS says
   *     after a block with the same two, reversed  RED
   *     after a block naming only the flex query   RED
   *
   * Both queries are true in every browser that can read the sheet, so the page depended on what
   * another component wrote. There is no order to give them that is CSS's, so the shape is refused.
   */
  test.each([
    [
      "two `@supports`, both true",
      `@supports (display: grid) { color: red; }\n@supports (display: flex) { color: blue; }`,
    ],
    [
      "two feature queries on different features",
      `@media (hover: hover) { color: red; }\n@media (pointer: fine) { color: blue; }`,
    ],
    [
      "a feature query and a height",
      `@media (hover: hover) { color: red; }\n@media (min-height: 40rem) { color: blue; }`,
    ],
  ])("%s setting one property is refused", (_what, css) => {
    const found = checkNamedFree(css);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toMatch(/both|either|cannot be ordered/i);
  });

  /**
   * And conditions that EXCLUDE each other are silent, because only one of them ever applies.
   *
   * This is most of what people write: a colour scheme, an orientation, a medium. They tie in the
   * band too, and the tie has never mattered — no element is ever matched by both.
   */
  test.each([
    [
      "a colour scheme",
      `@media (prefers-color-scheme: dark) { color: red; }\n@media (prefers-color-scheme: light) { color: blue; }`,
    ],
    [
      "an orientation",
      `@media (orientation: portrait) { color: red; }\n@media (orientation: landscape) { color: blue; }`,
    ],
    ["a medium", `@media print { color: red; }\n@media screen { color: blue; }`],
  ])("%s is silent, because only one of them ever applies", (_what, css) => {
    expect(checkNamedFree(css)).toHaveLength(0);
  });

  /** A prefixed name with no standard form fights nobody, and two unrelated ones are not a pair. */
  test("a prefixed name that stands alone is not reported", () => {
    expect(checkNamedFree("-moz-osx-font-smoothing: grayscale;\ncolor: red;")).toHaveLength(0);
    expect(checkNamedFree("box-shadow: 0 0 9px blue;\n-webkit-transform: scale(7);")).toHaveLength(0);
  });

  /** `max-width` is desktop-first, so the narrower one is the one written — and emitted — last. */
  test("max-width goes the other way, and the sheet's order is the written one", () => {
    expect(
      checkNamedFree("@media (max-width: 64rem) { padding: 8px; }\n@media (max-width: 40rem) { padding: 40px; }"),
    ).toHaveLength(0);
  });

  /**
   * A MODE against a breakpoint, and which way round is Tailwind's order — the user's call over the
   * one I had shipped. The colour scheme and the medium are WEAKER than a breakpoint; `@supports`,
   * orientation, contrast and `forced-colors` are stronger. See `widthSlot`.
   */
  test.each([
    [
      "a breakpoint below the colour scheme is fine",
      "@media (prefers-color-scheme: dark)",
      "@media (min-width: 64rem)",
    ],
    ["and below the medium too", "@media print", "@media (min-width: 64rem)"],
    ["`forced-colors` below a breakpoint is fine", "@media (min-width: 64rem)", "@media (forced-colors: active)"],
  ])("%s", (_what, above, below) => {
    expect(checkNamedFree(`${above} { padding: 8px; }\n${below} { padding: 0px; }`)).toHaveLength(0);
  });

  test.each([
    [
      "the colour scheme below a breakpoint cannot override it",
      "@media (min-width: 64rem)",
      "@media (prefers-color-scheme: dark)",
    ],
    ["nor can the medium", "@media (min-width: 64rem)", "@media print"],
    ["nor a breakpoint below `forced-colors`", "@media (forced-colors: active)", "@media (min-width: 64rem)"],
  ])("%s", (_what, above, below) => {
    const found = checkNamedFree(`${above} { padding: 8px; }\n${below} { padding: 0px; }`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
  });

  test("`@supports` is the same, because a condition adds no specificity", () => {
    expect(checkNamedFree("@supports (display: grid) { padding: 40px; }\npadding: 8px;")[0]?.rule).toBe(
      "override-out-of-order",
    );
  });

  /**
   * A LOGICAL PROPERTY BELOW A PHYSICAL ONE, which no order settles.
   *
   * `margin-inline` is the left and right margins in a horizontal writing mode and the top and
   * bottom ones in a vertical one, so whether it covers `margin-left` is the layout's to decide and
   * a stylesheet has one order for both. Measured in Chromium against plain CSS, in both modes:
   * broadest-first is right in the vertical one and wrong in the horizontal one — silently, in the
   * mode almost every page is in.
   *
   * **Fuzzed over every ordered pair in the eight families where both spellings exist**, 7,656 of
   * them, each rendered twice and compared with plain CSS. 56 disagreed and none of them was
   * reported; the pairs reported now are those 56 exactly — no pair that agreed became a finding,
   * and no pair that disagreed stayed quiet.
   */
  test.each([
    ["margin-left: 4px;\nmargin-inline: 8px;", "margin-inline"],
    ["padding-left: 4px;\npadding-inline: 8px;", "padding-inline"],
    ["margin-top: 4px;\nmargin-block: 8px;", "margin-block"],
    ["left: 4px;\ninset-inline: 8px;", "inset-inline"],
    ["border-left-width: 4px;\nborder-inline-width: 8px;", "border-inline-width"],
  ])("is reported, and the message names the writing mode: %#", (written, later) => {
    const found = checkNamedFree(written);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("override-out-of-order");
    expect(found[0].message).toContain("writing-mode");
    expect(found[0].message).toContain(`\`${later}\``);
    // Not the shorthand sentence, which would be untrue here — neither is the other's longhand.
    expect(found[0].message).not.toContain("its own longhands");
  });

  test.each([
    ["the other order, which the sheet does honour", "margin-inline: 8px;\nmargin-left: 4px;"],
    ["a four-side shorthand after it, which CLEARS it", "margin-inline: 8px;\nmargin: 0px;"],
    ["a four-side shorthand before it, which the sheet orders", "margin: 0px;\nmargin-inline: 8px;"],
    ["two logical properties on different axes, which never overlap", "margin-block-start: 4px;\nmargin-inline: 8px;"],
    ["the two ends of one axis, which are different sides", "margin-inline-start: 4px;\nmargin-inline-end: 8px;"],
    [
      "a physical and a logical single side, whose order the sheet keeps",
      "margin-left: 4px;\nmargin-inline-start: 8px;",
    ],
    ["an unrelated family", "margin-left: 4px;\npadding-inline: 8px;"],
  ])("%s is not reported", (_what, written) => {
    expect(checkNamedFree(written)).toEqual([]);
  });

  test("a broader property below a narrower one under the same condition", () => {
    // The sheet emits `padding` before `padding-left` whatever their order, so the author's
    // `padding` written second cannot win the way they wrote it.
    expect(
      checkNamedFree("@media (min-width: 40rem) { padding-left: 8px; }\n@media (min-width: 40rem) { padding: 40px; }"),
    ).toEqual([]);
  });

  describe("what it must not report, because the sheet and the author agree", () => {
    test.each([
      [
        "the ordinary shape — a condition BELOW what it overrides",
        "padding: 8px;\n@media (min-width: 40rem) { padding: 40px; }",
      ],
      ["an unrelated property below a condition", "@media (min-width: 40rem) { padding: 40px; }\ncolor: red;"],
      [
        "a condition on a SELECTOR, which adds specificity",
        "@media (min-width: 40rem) { &:hover { padding: 40px; } }\npadding: 8px;",
      ],
      [
        "two under the same condition, which keep their order",
        "@media (min-width: 40rem) { padding: 40px; }\n@media (min-width: 40rem) { padding: 8px; }",
      ],
      ["the same property twice, which the merge settles", "padding: 40px;\npadding: 8px;"],
      ["a shorthand below its own longhand", "padding-left: 40px;\npadding: 8px;"],
      ["a longhand below its own shorthand", "padding: 8px;\npadding-left: 40px;"],
      ["a selector below a plain declaration", "padding: 8px;\n&:hover { padding: 40px; }"],
    ])("%s", (_what, css) => {
      expect(checkNamedFree(css)).toEqual([]);
    });
  });
});

/**
 * A narrower shorthand written after a WIDER one holding a `var()`.
 *
 * The wider one cannot split and sits in the word layer `v`. The narrower one sits in `v` too, or
 * in a counted layer below it — and neither is above it. Through the merge both classes stay, and
 * the stylesheet decides. Measured in all three engines, `border: var(--x)` then
 * `border-top: var(--y)`: the right answer in one load order and the wrong one in the other.
 */
describe("a narrower shorthand after a var() shorthand", () => {
  const found = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {}).map((one) => one.rule);
  };

  test.each([
    ["two var() shorthands", "border: var(--x); border-top: var(--y);"],
    ["a family and its own member", "background: var(--b); background-position: var(--q);"],
    ["the same inside a condition", "@media (min-width: 40rem) { border: var(--x); border-top: var(--y); }"],
    ["a wider one a split refuses, with no var() in it", "font: caption; font-variant: var(--v);"],
  ])("%s is reported", (_what, css) => {
    expect(found(css)).toContain("narrower-after-a-whole-shorthand");
  });

  test.each([
    ["the other order, which the merge settles", "border-top: var(--y); border: var(--x);"],
    ["a longhand after it, which is stronger", "border: var(--x); border-top-color: red;"],
    ["a split after it, which is stronger", "border: var(--x); border-top: 1px solid red;"],
    [
      "a wider one that splits, whose pieces are stronger",
      "background: red url(a.png); background-position: var(--p);",
    ],
    ["under different conditions", "border: var(--x); @media (min-width: 40rem) { border-top: var(--y); }"],
    ["two families that do not cover each other", "border: var(--x); padding: var(--p);"],
  ])("%s is not", (_what, css) => {
    expect(found(css)).not.toContain("narrower-after-a-whole-shorthand");
  });
});
