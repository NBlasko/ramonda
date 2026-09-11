import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { compose, forget, merge } from "../merge";
import { block } from "../value";
import { SHORTHANDS } from "../compiler/keywords.generated";

/**
 * Composition, which happens at the CALL SITE and nowhere else.
 *
 * A block compiles to a map from what a declaration sets to the class that sets it, and merging two
 * of them keeps, per thing set, the one written later. **That is the only way the call site can
 * decide anything**, and it was measured: the order of classes in a `class` attribute decides
 * nothing — the stylesheet's order does — so two whole-block classes cannot say which one wins.
 * Keeping one class per thing set means there is never a tie to break.
 *
 * What comes out is the value the framework already takes: a class string, property names, values.
 * Nothing in `@ramonda/core` changes for any of this.
 */
const CLASS = "r-1111111111111111";

describe("what a merge produces", () => {
  test("one map is that map, spelled as a value", () => {
    expect(merge({ display: "r-aaaaaaaaaaaaaaaa" })).toEqual({
      className: "r-aaaaaaaaaaaaaaaa",
      properties: [],
      values: [],
    });
  });

  test("two maps setting different things keep both", () => {
    const { className } = merge({ display: "r-aaaaaaaaaaaaaaaa" }, { color: "r-bbbbbbbbbbbbbbbb" });

    expect(className.split(" ").sort()).toEqual(["r-aaaaaaaaaaaaaaaa", "r-bbbbbbbbbbbbbbbb"]);
  });

  test("two maps setting the SAME thing keep the later one, and only it", () => {
    const { className } = merge({ color: "r-aaaaaaaaaaaaaaaa" }, { color: "r-bbbbbbbbbbbbbbbb" });

    expect(className).toBe("r-bbbbbbbbbbbbbbbb");
  });

  test("a falsy argument is a group that is switched off", () => {
    const on = { opacity: "r-bbbbbbbbbbbbbbbb" };
    const base = { display: "r-aaaaaaaaaaaaaaaa" };
    /** What `disabled && block` compiles to, with the condition where a condition really is. */
    const when = (condition: boolean) => merge(base, condition && on).className;

    expect(when(false)).toBe("r-aaaaaaaaaaaaaaaa");
    expect(when(true).split(" ")).toHaveLength(2);
    expect(merge(base, undefined, null).className).toBe("r-aaaaaaaaaaaaaaaa");
  });

  test("and no arguments at all is a value that styles nothing", () => {
    expect(merge()).toEqual({ className: "", properties: [], values: [] });
  });
});

describe("a hole's value, which travels with its class", () => {
  test("becomes a custom property named after that class", () => {
    expect(merge({ color: [CLASS, "#10b981"] })).toEqual({
      className: CLASS,
      properties: [`--${CLASS}-0`],
      values: ["#10b981"],
    });
  });

  test("a declaration with two holes numbers them in order", () => {
    const { properties, values } = merge({ "border-left": [CLASS, "4px", "red"] });

    expect(properties).toEqual([`--${CLASS}-0`, `--${CLASS}-1`]);
    expect(values).toEqual(["4px", "red"]);
  });

  test("and a later map's value replaces an earlier one for the same thing", () => {
    const { className, properties, values } = merge({ color: [CLASS, "red"] }, { color: [CLASS, "blue"] });

    expect(className).toBe(CLASS);
    expect(properties).toEqual([`--${CLASS}-0`]);
    expect(values).toEqual(["blue"]);
  });
});

/**
 * A DECLARATION WITH NOTHING TO SET IS NOT SET, so what it would have overridden survives.
 *
 * `...{base}; color: {tint}` with `tint = null` used to delete the base's class for that key and
 * leave the modifier's, whose `var()` was unset — so `color` computed to inherit rather than the
 * base's red. **The comments in `value.ts` and `merge.ts` both promised the fall-back**, and the
 * code did the opposite one step earlier than either of them looked.
 *
 * A class stands for exactly one declaration, which is what makes dropping it safe: there is nothing
 * else on it to lose. And a declaration reading an unset `var()` is invalid at computed-value time
 * anyway, so the class was never going to apply — it was only in the way.
 *
 * The same as `twMerge`, measured against 3.6.0: `twMerge("text-red-500", null)` is `"text-red-500"`.
 *
 * The type refuses `null` and `undefined` in a hole — see `__val` in `virtual.ts` — so this is the
 * belt for what a type cannot hold: a cast, an `any`, a JavaScript caller, data off an API.
 */
describe("a hole with no value", () => {
  const BASE = "r-3333333333333333";

  test("does not take the base's declaration with it", () => {
    const { className, properties } = merge({ color: BASE }, { color: [CLASS, null as never] });

    expect(className).toBe(BASE);
    expect(properties).toEqual([]);
  });

  test("undefined is the same answer", () => {
    expect(merge({ color: BASE }, { color: [CLASS, undefined as never] }).className).toBe(BASE);
  });

  test("with no base, nothing is applied — which is the same page either way", () => {
    expect(merge({ color: [CLASS, null as never] })).toEqual({ className: "", properties: [], values: [] });
  });

  /**
   * ONE null among several is still nothing to set. `border-left: {w} solid {c}` with `c` missing
   * reads an unset `var()`, and a declaration with one of those is dropped whole by the browser.
   */
  test("one missing value among several drops the whole declaration", () => {
    const { className } = merge({ "border-left": BASE }, { "border-left": [CLASS, "4px", null as never] });

    expect(className).toBe(BASE);
  });

  test("and a value that IS carried still wins, so this is not just 'the first one'", () => {
    expect(merge({ color: BASE }, { color: [CLASS, "blue"] }).className).toBe(CLASS);
  });

  /** It clears nothing either: a shorthand that sets nothing cannot clear what an earlier one set. */
  test("clears nothing, because it sets nothing", () => {
    const { className } = merge(
      { "padding-left": BASE },
      { padding: [CLASS, null as never], "~padding": ["padding-left"] },
    );

    expect(className).toBe(BASE);
  });

  /** And `compose` answers the same, because it is the primitive the nested case composes with. */
  test("compose leaves the earlier entry in place", () => {
    expect(compose({ color: BASE }, { color: [CLASS, null as never] })).toEqual({ color: BASE });
  });
});

/**
 * A VALUE WITH NO MAP — what the public `block` produces, which the compiler has not emitted for
 * some time.
 *
 * `mapOf` answers `one[FROM] ?? one`, so a bare value had its own FIELDS read as declarations:
 * `className`, `properties` and `values` became things set, and their contents became class names.
 * Measured: `merge(block("r-def"))` came back with `className: "r-def undefined undefined"` — the
 * word `undefined` written into an element's class attribute.
 *
 * It cannot compose, and that is a fact about the value rather than a limitation of this: a map says
 * what each class SETS and a bare value has thrown that away. What it can still do is LAND.
 *
 * Not reachable from compiled code — but `block` and `merge` are both public exports, and four
 * documents showed `block(…)` as what the compiler emits. They pointed straight at it.
 */
describe("a value that carries no map", () => {
  test("lands unchanged, class and holes and all", () => {
    const value = block("r-abc0000000000000", ["--r-abc0000000000000-0"] as const)("red");

    expect(merge(value)).toEqual({
      className: "r-abc0000000000000",
      properties: ["--r-abc0000000000000-0"],
      values: ["red"],
    });
  });

  test("a descriptor with no holes lands as its class, with no `undefined` anywhere", () => {
    expect(merge(block("r-def0000000000000"))).toEqual({
      className: "r-def0000000000000",
      properties: [],
      values: [],
    });
  });

  test("beside a map, both land", () => {
    const { className } = merge({ color: CLASS }, block("r-def0000000000000"));

    expect(className.split(" ").sort()).toEqual([CLASS, "r-def0000000000000"].sort());
  });

  /**
   * It takes part in no OVERRIDE, which is the honest consequence of having no map: there is nothing
   * to decide with. A merged value keeps its own, so the two behave differently on purpose.
   */
  test("it overrides nothing, where a merged value does", () => {
    const base = { color: "r-c-red000000000000" };
    const bare = block("r-def0000000000000");

    expect(merge(base, bare).className.split(" ")).toHaveLength(2);
    expect(merge(base, merge(base)).className.split(" ")).toHaveLength(1);
  });

  test("and the same one twice is one class", () => {
    const bare = block("r-def0000000000000");

    expect(merge(bare, bare).className).toBe("r-def0000000000000");
  });
});

/**
 * A shorthand and its longhand are DIFFERENT things set, so a merge keeps both and the STYLESHEET
 * breaks the tie — measured, and possibly against the call site. So the merge does what CSS's own
 * cascade does: a later shorthand clears its own longhands.
 *
 * **The list travels with the block that needs it**, under a key beginning with `~`, which no CSS
 * property may begin with. That is what keeps a table of 78 shorthands out of every page: a block
 * pays for the shorthands it actually writes and nothing else.
 */
describe("a shorthand meeting its own longhand", () => {
  const PADDING = "r-2222222222222222";
  const LEFT = "r-3333333333333333";
  const shorthand = { padding: PADDING, "~padding": ["padding-top", "padding-left"] };
  const longhand = { "padding-left": LEFT };

  test("a later shorthand clears it, which is what CSS says", () => {
    expect(merge(longhand, shorthand).className).toBe(PADDING);
  });

  test("an earlier one does not, because the sheet emits the longhand after it", () => {
    const { className } = merge(shorthand, longhand);

    expect(className.split(" ").sort()).toEqual([LEFT, PADDING].sort());
  });

  test("the list itself never reaches the element", () => {
    expect(merge(shorthand).className).toBe(PADDING);
  });

  /**
   * `compose` is the primitive and `merge` is the boundary: one composes with itself, the other
   * produces the value the framework takes and cannot be composed again. A nested group composes, so
   * this is the property that lets a nested `if` mean what a flattened one means.
   */
  test("and clearing is associative, which is what lets a group nest", () => {
    const other = { "padding-top": "r-4444444444444444" };
    const flat = merge(other, longhand, shorthand).className;

    expect(merge(other, compose(longhand, shorthand)).className).toBe(flat);
    expect(merge(compose(other, longhand), shorthand).className).toBe(flat);
    expect(merge(compose(compose(other, longhand), shorthand)).className).toBe(flat);
  });
});

/**
 * A clear-list names full KEYS, not property names, and both halves of that were nearly wrong.
 *
 * A key carries the context it was written in, so `padding` inside a `@media` clears `padding-left`
 * inside THAT `@media` and leaves the one outside it alone — they are different declarations on
 * different conditions and neither replaces the other. And a key may contain spaces, so a list
 * joined by one could not be split back.
 */
describe("clearing inside a condition", () => {
  const WIDE = "@media (min-width: 40rem)";

  test("clears only what shares its context", () => {
    const outside = { "padding-left": "r-outside00000000" };
    const inside = {
      [`${WIDE}|padding`]: "r-inside000000000",
      [`~${WIDE}|padding`]: [`${WIDE}|padding-left`],
    };

    const { className } = merge(outside, { [`${WIDE}|padding-left`]: "r-innerleft000000" }, inside);

    expect(className.split(" ").sort()).toEqual(["r-inside000000000", "r-outside00000000"]);
  });

  test("and a key holding a space survives being a list entry", () => {
    const map = {
      [`${WIDE}|padding`]: "r-aaaaaaaaaaaaaaaa",
      [`~${WIDE}|padding`]: [`${WIDE}|padding-left`],
    };

    expect(merge({ [`${WIDE}|padding-left`]: "r-bbbbbbbbbbbbbbbb" }, map).className).toBe("r-aaaaaaaaaaaaaaaa");
  });
});

/**
 * A merged VALUE, spread back into another merge — which is what `...{{base}};` does.
 *
 * `const base = @@( … )` compiles to a merged value, not to a map, because that is what the `css`
 * prop takes. So a spread of it hands `merge` the value, and a value has none of the keys a map has.
 *
 * **Measured before this existed, and it failed in the worst way — quietly and only sometimes:** a
 * base spread into a modifier still produced a plausible class string, because iterating a value's
 * own keys happens to yield its `className`. What it lost was the map, so nothing could be
 * overridden and nothing could be cleared — `padding: 8px` in the modifier left the base's
 * `padding-left: 40px` standing.
 *
 * So a value carries the map it came from, and `compose` reads it back.
 */
describe("a value spread back in", () => {
  const base = { "padding-left": "r-left0000000000000", cursor: "r-pointer000000000" };
  const roomy = { padding: "r-padding000000000", "~padding": ["padding-left"] };

  test("composes as the map it came from", () => {
    const value = merge(base);

    expect(merge(value, roomy).className).toBe("r-pointer000000000 r-padding000000000");
  });

  test("and so does one that was composed already", () => {
    const value = merge(base, { opacity: "r-opacity000000000" });

    expect(merge(value, roomy).className.split(" ").sort()).toEqual(
      ["r-pointer000000000", "r-opacity000000000", "r-padding000000000"].sort(),
    );
  });

  test("which is the same answer as merging the maps directly", () => {
    expect(merge(merge(base), roomy).className).toBe(merge(base, roomy).className);
  });

  /**
   * THE SHAPE THE AUTHOR ACTUALLY WRITES, in the form the compiler emits it.
   *
   *     const base = @@( color: red; );
   *     <div css=@@( ...{base}; color: {tint}; )>
   *
   *     _merge(base, {"color": ["r-OsXzXT1Qd", tint]})
   *
   * With `tint = null` this used to come back holding only the modifier's class, whose `var()` was
   * unset — so the text was inherit-coloured rather than red. The base is what the author expects to
   * see, and it is what the two files' comments already promised.
   */
  test("a base spread in survives a modifier whose hole is empty", () => {
    const tinted = (tint: string | null) =>
      merge(merge({ color: "r-c-red000000000000" }), { color: ["r-tint00000000000", tint as never] });

    expect(tinted(null).className).toBe("r-c-red000000000000");
    expect(tinted("blue").className).toBe("r-tint00000000000");
  });
});

/**
 * A LOGICAL shorthand clears its own side, and four of them cleared somebody else's.
 *
 * The table the merge reads is derived from `mdn-data`'s `initial` field, which lists a shorthand's
 * longhands by convention — and for four logical border shorthands that field names something else
 * entirely. A review of this file measured what it cost, and it is not subtle:
 *
 *     color: red; border-block-start: 1px solid blue;    `color: red` silently gone
 *     border-top: …; border-block-end: …;                `border-top` silently gone
 *
 * `border-block-start`, `border-inline-start` and `border-inline-end` were all given
 * `["border-width", "border-style", "color"]` — two shorthands covering every PHYSICAL border
 * longhand, plus `color`, which is an unrelated property. `border-block-end` was given the
 * `border-top-*` longhands, which is the wrong side.
 *
 * Corrected in the generator, with an assertion that fails the build when the next logical
 * shorthand's leaves fall outside its own name — and again when a correction stops being needed.
 */
describe("a logical shorthand clears its own side and nothing else", () => {
  /** The list the merge actually reads, straight out of the generated table. */
  const clears = (shorthand: string) => SHORTHANDS[shorthand] ?? [];

  test.each(["border-block-start", "border-block-end", "border-inline-start", "border-inline-end"])(
    "%s does not name `color`",
    (shorthand) => {
      expect(clears(shorthand)).not.toContain("color");
    },
  );

  /**
   * Its own side, plus any OTHER NAME for the same property — which is a browser's old spelling.
   *
   * Written as an exact list once, and it stopped being exact when the prefixed names entered the
   * table: `border-block-start` also clears `-webkit-border-before`, and that is right rather than a
   * regression. Measured — they are one property under two names:
   *
   *     border-block-start: 7px solid rgb(1,2,3)  ->  -webkit-border-before reads it back
   *     -webkit-border-before: initial            ->  border-block-start becomes `initial`
   *
   * So not clearing it would leave two classes for one property with the sheet breaking the tie.
   * What the claim really is: nothing from ANOTHER side. That is what this asserts now, and it is
   * the thing that was ever wrong — `border-block-end` naming `border-top-*`.
   */
  test.each(["border-block-start", "border-block-end", "border-inline-start", "border-inline-end"])(
    "%s names nothing from another side",
    (shorthand) => {
      const side = shorthand.replace("border-", "");
      const others = ["block-start", "block-end", "inline-start", "inline-end", "top", "bottom", "left", "right"]
        .filter((one) => one !== side)
        .map((one) => `border-${one}`);

      for (const one of clears(shorthand)) {
        expect(
          others.some((other) => one === other || one.startsWith(`${other}-`)),
          `${shorthand} clears ${one}`,
        ).toBe(false);
      }
      // And its own three leaves are there, which is what it is FOR.
      for (const part of ["color", "style", "width"]) expect(clears(shorthand)).toContain(`${shorthand}-${part}`);
    },
  );

  /** The physical side, which was never wrong, and the corner family, whose names are its own. */
  test("`border-top` is unchanged, and a corner still names the corners it sets", () => {
    expect([...clears("border-top")].sort()).toEqual(
      ["border-top-color", "border-top-style", "border-top-width"].sort(),
    );
    expect([...clears("corner-block-end-shape")].sort()).toEqual(
      ["corner-end-end-shape", "corner-end-start-shape"].sort(),
    );
  });

  /**
   * And the same fact through the runtime, which is where it was costing something: the map a
   * compiled block hands `merge` carries the list under `~`, so a wrong list is a class deleted.
   */
  test("`color` survives a `border-block-start` beside it", () => {
    const withColor = { color: "r-c-red" };
    const withBorder = {
      "border-block-start": "r-bbs-1px",
      "~border-block-start": [...clears("border-block-start")],
    };

    expect(merge(withColor, withBorder).className.split(" ").sort()).toEqual(["r-bbs-1px", "r-c-red"]);
  });

  test("and its own longhand does not", () => {
    const withLonghand = { "border-block-start-width": "r-bbsw-1px" };
    const withBorder = {
      "border-block-start": "r-bbs-2px",
      "~border-block-start": [...clears("border-block-start")],
    };

    expect(merge(withLonghand, withBorder).className).toBe("r-bbs-2px");
  });
});

/**
 * A FOUR-SIDE SHORTHAND CLEARS THE LOGICAL SPELLINGS TOO, and that direction alone.
 *
 * The two families share no longhand — one is written in `margin-left`, the other in
 * `margin-inline-start` — so a subset of leaves saw nothing in common and the merge cleared
 * neither. Measured in Chromium against plain CSS: `margin-inline: 8px; margin: 0px` left both
 * classes on the element, and `margin-inline` won a declaration `margin` had replaced.
 *
 * **It is one-way, because only one way is true in every writing mode.** `margin` sets all four
 * sides, so it covers whichever pair `margin-inline` turns out to be. The reverse is the writing
 * mode's to decide — measured, `margin-left: 4px; margin-inline: 8px` is `margin-inline` on both
 * sides in `horizontal-tb` and `margin-left` surviving in `vertical-rl` — so nothing is cleared and
 * `override-out-of-order` reports the pair instead.
 */
describe("a four-side shorthand meeting a logical one", () => {
  const clears = (name: string) => new Set(SHORTHANDS[name] ?? []);

  test.each([
    ["margin", "margin-inline"],
    ["margin", "margin-block-start"],
    ["padding", "padding-inline"],
    ["inset", "inset-inline-end"],
    ["border-width", "border-inline-width"],
    ["border-radius", "border-start-start-radius"],
    ["scroll-padding", "scroll-padding-block"],
  ])("`%s` clears `%s`", (broad, logical) => {
    expect(clears(broad).has(logical)).toBe(true);
  });

  test.each([
    ["margin-inline", "margin-left"],
    ["margin-block", "margin-top"],
    ["padding-inline", "padding-left"],
    ["inset-inline", "left"],
  ])("`%s` does NOT clear `%s`, because only the writing mode knows", (logical, physical) => {
    expect(clears(logical).has(physical)).toBe(false);
  });

  test("and the runtime does what the table says", () => {
    const inline = { "margin-inline": "r-mx-8px", "~margin-inline": [...clears("margin-inline")] };
    const all = { margin: "r-m-0px", "~margin": [...clears("margin")] };

    expect(merge(inline, all).className).toBe("r-m-0px");
    // The other order keeps both: `margin` cannot clear what is written after it, and the sheet
    // emits it first, so `margin-inline` wins — which is what plain CSS does too.
    expect(merge(all, inline).className.split(" ").sort()).toEqual(["r-m-0px", "r-mx-8px"]);
  });

  /**
   * `border-inline-width` is a SHORTHAND that `mdn-data` does not know is one — its `initial` is
   * `"medium"`, the initial value, where every other shorthand's is a list of longhands. Derived in
   * the generator, which also fails the build if the set of six ever changes.
   */
  test.each([
    "border-block-color",
    "border-block-style",
    "border-block-width",
    "border-inline-color",
    "border-inline-style",
    "border-inline-width",
  ])("`%s` is read as the shorthand it is", (name) => {
    expect(clears(name).size).toBeGreaterThan(0);
  });
});

/**
 * **WHAT A SHORTHAND CLEARS, against the ENGINES rather than against our own table.**
 *
 * `SHORTHANDS` drives four things — the layer a rule lands in, the sheet's minor order, what a merge
 * clears, and the `~` list emitted into every block — so a wrong entry silently loses a style. The
 * data used to come from `mdn-data`'s `initial` field, which was patched by hand twice for exactly
 * that fault and was measured still missing **37** longhands after both patches. Five were verified
 * end to end against plain CSS in Chromium; `row-gap: 7px; grid-gap: 2px` gave 7px where CSS gives
 * 2px.
 *
 * It comes from `leaves.generated.ts` now — Chromium, Firefox and WebKit, asked directly. So the
 * test that matters is not "does the table say what we wrote down", it is **does the merge agree
 * with a browser**, and that is what this asks: the same two declarations, through the merge and the
 * sheet, against the same two in plain CSS.
 *
 * Two shorthands per family rather than all 98, because the question is whether the SOURCE is right
 * and a browser answers that for any of them. `prototype-shorthands.mjs` sweeps the whole table.
 */
describe("a shorthand clears what a browser resets", () => {
  test.each([
    ["the longhand a shorthand's `initial` field forgot", "row-gap", "7px", "grid-gap", "2px"],
    ["a border image, which `border` resets", "border-image-source", 'url("zz.png")', "border", "1px solid black"],
    ["a decoration's thickness", "text-decoration-thickness", "7px", "text-decoration", "underline"],
    ["a background position axis", "background-position-x", "37%", "background", "red"],
    [
      "a logical border's colour",
      "border-inline-start-color",
      "rgb(1, 2, 3)",
      "border-inline",
      "2px solid rgb(9, 9, 9)",
    ],
  ])("%s", (_what, longhand, longValue, shorthand, shortValue) => {
    const cleared = SHORTHANDS[shorthand];

    expect(cleared, `${shorthand} is not in the table at all`).toBeDefined();
    expect(cleared, `${shorthand} does not clear ${longhand}`).toContain(longhand);

    // And the merge keeps only the shorthand, which is what clearing MEANS at the call site.
    const value = merge(
      { [longhand]: `r-${longhand}`, [`~${longhand}`]: [] as never },
      { [shorthand]: `r-${shorthand}`, [`~${shorthand}`]: cleared as never },
    );
    expect(value.className.split(" ")).toEqual([`r-${shorthand}`]);
    void longValue;
    void shortValue;
  });

  /**
   * And the direction that would DELETE the author's work: a longhand a browser keeps must not be
   * cleared. Measured across all 98 shorthands and every leaf: zero.
   */
  test("and nothing a browser keeps is cleared", () => {
    // `border-radius` and `border-width` are different families — neither resets the other.
    expect(SHORTHANDS["border-radius"] ?? []).not.toContain("border-top-width");
    expect(SHORTHANDS["border-width"] ?? []).not.toContain("border-top-left-radius");
    // A longhand clears nothing at all, whatever it is called.
    expect(SHORTHANDS["margin-top"]).toBeUndefined();
    expect(SHORTHANDS.color).toBeUndefined();
  });
});

/**
 * The override a SPREAD hides, said out loud in dev — the one hole the compiler cannot see.
 *
 * Two declarations of one property under different conditions are different keys, so the merge keeps
 * both and the sheet breaks the tie by how strongly each condition overrides. Within one block
 * `override-out-of-order` reports where that contradicts the author's order; across `...{base}` it
 * cannot, because a spread's operand is a runtime value. Only the runtime holds both maps.
 */
describe("an override the stylesheet will not honour", () => {
  const said: string[] = [];
  const real = console.warn;

  beforeEach(() => {
    said.length = 0;
    console.warn = (message: string) => said.push(message);
  });
  afterEach(() => {
    console.warn = real;
    // The warning is said once per pair for the life of the module, so each test needs its own.
    forget();
  });

  const under = (condition: string, property: string, value: string) => ({
    [`${condition}|${property}`]: `r-${value}`,
  });

  test("a mode composed after a breakpoint cannot override it, and is reported", () => {
    compose(
      under("@media (min-width: 40rem)", "color", "wide"),
      under("@media (prefers-color-scheme: dark)", "color", "dark"),
    );

    expect(said).toHaveLength(1);
    expect(said[0]).toContain("`color`");
    expect(said[0]).toContain("prefers-color-scheme");
    expect(said[0]).toContain("min-width: 40rem");
  });

  test("and the way round the stylesheet does honour is silent", () => {
    compose(
      under("@media (prefers-color-scheme: dark)", "color", "dark"),
      under("@media (min-width: 40rem)", "color", "wide"),
    );

    expect(said).toEqual([]);
  });

  test("two breakpoints, the wider one composed later, is silent", () => {
    compose(under("@media (min-width: 40rem)", "color", "narrow"), under("@media (min-width: 64rem)", "color", "wide"));

    expect(said).toEqual([]);
  });

  test("and the narrower one composed later is reported", () => {
    compose(under("@media (min-width: 64rem)", "color", "wide"), under("@media (min-width: 40rem)", "color", "narrow"));

    expect(said).toHaveLength(1);
  });

  /**
   * A SELECTOR settles it by specificity, not by the sheet — so comparing the pair would report
   * correct CSS, which is the failure mode this package has already paid for.
   */
  test("a selector against a condition is not compared at all", () => {
    compose(under("@media (min-width: 40rem)", "color", "wide"), { "&:hover|color": "r-hover" });

    expect(said).toEqual([]);
  });

  /** And a key whose parts cannot be split apart is left alone rather than guessed at. */
  test("a condition holding the key's own separator is not compared", () => {
    compose(under("@media (min-width: 40rem)", "color", "wide"), {
      '@supports selector([title|="x"])|color': "r-supports",
    });

    expect(said).toEqual([]);
  });

  test("two properties that do not fight are not compared", () => {
    compose(
      under("@media (min-width: 40rem)", "color", "wide"),
      under("@media (prefers-color-scheme: dark)", "background-color", "dark"),
    );

    expect(said).toEqual([]);
  });

  /** One block on its own is the compiler's to report, at the author's line. */
  test("a single map is not checked here at all", () => {
    compose({
      "@media (min-width: 40rem)|color": "r-wide",
      "@media (prefers-color-scheme: dark)|color": "r-dark",
    });

    expect(said).toEqual([]);
  });

  test("and it is said once, however many times the same thing is composed", () => {
    for (let index = 0; index < 5; index++) {
      compose(
        under("@media (min-width: 40rem)", "color", "wide"),
        under("@media (prefers-color-scheme: dark)", "color", "dark"),
      );
    }

    expect(said).toHaveLength(1);
  });
});

/**
 * **THE WARNING MISSED EVERY SHORTHAND, and that is all 98 families.**
 *
 * `warnAboutOrder` exists for the one hole the compiler cannot see: `...{base}` is a runtime value,
 * so nothing at build time knows what is in it. It grouped by the EXACT property name, so
 * `padding` and `padding-left` were never compared — and a shorthand under a condition silently beat
 * a longhand composed after it.
 *
 * Measured against plain CSS in Chromium, over 425 compositions of 21 blocks: 406 agreed, 17
 * disagreed AND warned (the documented cross-condition answer), and **2 disagreed with nothing
 * said** — both this shape:
 *
 *     ...{@media (min-width: 1px) { padding: 11px }};  padding-left: 4px
 *         ours 11px        plain CSS 4px
 *
 * Then swept across the whole table: **98 shorthand families asked, 0 warned, 98 silent.**
 *
 * The single-file checker catches all of it, because `override-out-of-order` knows the shorthand
 * table through `covers()`. The runtime may not import that table — `conditions.ts` exists precisely
 * so `merge.ts` does not pull `flatten.ts` and put 98 families on every page — but it does not need
 * to: **the clear-list is already in the map**, under `~<context>|<property>`, because clearing is
 * how a shorthand displaces a longhand in the first place.
 */
describe("a shorthand composed under a condition", () => {
  const spoke: string[] = [];
  let real: typeof console.warn;

  beforeEach(() => {
    forget();
    spoke.length = 0;
    real = console.warn;
    console.warn = (...args: unknown[]) => void spoke.push(args.map(String).join(" "));
  });
  afterEach(() => {
    console.warn = real;
  });

  /** A conditional shorthand, and the longhands it sets — keyed the way the compiler keys them. */
  const conditional = (condition: string, shorthand: string, longhands: readonly string[]) => ({
    [`${condition}|${shorthand}`]: `r-${shorthand}`,
    [`~${condition}|${shorthand}`]: longhands.map((one) => `${condition}|${one}`) as never,
  });

  test("warns when a longhand it sets is composed after it", () => {
    const value = merge(conditional("@media (min-width: 1px)", "padding", ["padding-left", "padding-top"]), {
      "padding-left": "r-pl",
    });

    expect(spoke).toHaveLength(1);
    expect(spoke[0]).toContain("padding-left");
    expect(spoke[0]).toContain("padding");
    // Both classes land, because neither clears the other across a condition.
    expect(value.className.split(" ").sort()).toEqual(["r-padding", "r-pl"]);
  });

  test("and names both properties, because they are not the same one", () => {
    merge(conditional("@media print", "border", ["border-left-color"]), { "border-left-color": "r-blc" });

    expect(spoke[0]).toContain("border-left-color");
    expect(spoke[0]).toContain("border");
    expect(spoke[0]).toContain("@media print");
  });

  /** The other way round is fine: the stronger condition IS last, so it wins as written. */
  test("says nothing when the conditional shorthand is composed last", () => {
    merge({ "padding-left": "r-pl" }, conditional("@media (min-width: 1px)", "padding", ["padding-left"]));

    expect(spoke).toEqual([]);
  });

  /**
   * And nothing under ONE condition, where the layer order already settles it: a longhand's breadth
   * puts it after its shorthand, so composing it later is exactly what happens.
   */
  test.each([
    ["no condition at all", ""],
    ["one condition, on both", "@media (min-width: 1px)"],
  ])("says nothing with %s", (_what, condition) => {
    const key = (property: string) => (condition === "" ? property : `${condition}|${property}`);
    merge(
      {
        [key("padding")]: "r-p",
        [`~${key("padding")}`]: [key("padding-left")] as never,
      },
      { [key("padding-left")]: "r-pl" },
    );

    expect(spoke).toEqual([]);
  });

  /** A property outside the shorthand's family is not its business. */
  test("says nothing about an unrelated property", () => {
    merge(conditional("@media (min-width: 1px)", "padding", ["padding-left"]), { color: "r-c" });

    expect(spoke).toEqual([]);
  });

  /** And it stays silent in production, which is what the whole warning costs there: nothing. */
  test("says nothing in production", () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      merge(conditional("@media (min-width: 1px)", "padding", ["padding-left"]), { "padding-left": "r-pl" });
      expect(spoke).toEqual([]);
    } finally {
      process.env.NODE_ENV = was;
    }
  });
});
