import { describe, expect, test } from "vitest";
import { flatten, sheetRank, widthSlot } from "../compiler/flatten";
import { readBlock } from "../compiler/read";
import { findBlocks } from "../compiler/scan";

/**
 * A block, taken apart into the declarations it makes — which is what composition merges.
 *
 * A whole block is one class and one rule, so nothing ever had to say what a block SETS. Composition
 * does: two blocks merge by keeping, per thing set, the one written later. So each declaration needs
 * a KEY that is equal exactly when two declarations target the same thing, and canonical rather than
 * as-written — the contract is `CONTRACT.md` §1b and the two halves of it are measured:
 *
 * - **at-rules are sorted**, because they commute: `@media X { @supports Y { … } }` and the reverse
 *   are the same rule in Chromium, so an as-written key would let a modifier silently fail to
 *   override a base written the other way round;
 * - **selector parts compose in order**, because they do not: `&:hover` inside `& .title` is
 *   `& .title:hover`, and the reverse is a different element.
 */
const of = (css: string) => {
  const source = `const x = @@(\n${css}\n);`;
  const [site] = findBlocks(source);
  return flatten(readBlock(source, site.open, "", { tolerant: true }).block);
};

const keys = (css: string) => of(css).map((one) => one.key);

describe("what a block sets", () => {
  test("a flat block sets one thing per declaration", () => {
    expect(keys("display: flex;\ngap: 8px;")).toEqual(["display", "gap"]);
  });

  test("the property is folded to lower case, and a custom property is not", () => {
    expect(keys("COLOR: red;\n--Accent: blue;")).toEqual(["color", "--Accent"]);
  });

  test("a declaration written twice is kept twice, so the LATER one can win", () => {
    expect(keys("color: red;\ncolor: blue;")).toEqual(["color", "color"]);
    expect(of("color: red;\ncolor: blue;").map((one) => one.canonical)).toEqual(["color:red;", "color:blue;"]);
  });
});

describe("a nested selector", () => {
  test("becomes a suffix on the class", () => {
    const [one] = of("&:hover { background: red; }");

    expect(one.selector).toBe("&:hover");
    expect(one.key).toBe("&:hover|background");
  });

  test("a descendant keeps its space, because that is what it means", () => {
    expect(of("& .title { color: red; }")[0].selector).toBe("& .title");
  });

  test("and a bare selector is a descendant too, which is what CSS nesting says", () => {
    expect(of(".title { color: red; }")[0].selector).toBe("& .title");
  });

  test("nested twice composes, in order", () => {
    expect(of("& .title { &:hover { color: red; } }")[0].selector).toBe("& .title:hover");
    expect(of("&:hover { & .title { color: red; } }")[0].selector).toBe("&:hover .title");
  });
});

describe("a conditional at-rule", () => {
  test("becomes a condition rather than a selector", () => {
    const [one] = of("@media (min-width: 40rem) { padding: 24px; }");

    expect(one.conditions).toEqual(["@media (min-width: 40rem)"]);
    expect(one.selector).toBe("");
    expect(one.key).toBe("@media (min-width: 40rem)|padding");
  });

  test("two of them are SORTED, because they commute", () => {
    expect(of("@media (min-width: 40rem) { @supports (display: grid) { padding: 1px; } }")[0].conditions).toEqual([
      "@media (min-width: 40rem)",
      "@supports (display: grid)",
    ]);
    expect(of("@supports (display: grid) { @media (min-width: 40rem) { padding: 1px; } }")[0].conditions).toEqual([
      "@media (min-width: 40rem)",
      "@supports (display: grid)",
    ]);
  });

  /** The whole reason the key is canonical: two authors, two nesting orders, one thing set. */
  test("a condition around a selector and a selector around a condition are ONE key", () => {
    const a = of("@media (min-width: 40rem) { &:hover { color: red; } }")[0];
    const b = of("&:hover { @media (min-width: 40rem) { color: red; } }")[0];

    expect(a.key).toBe(b.key);
    expect(a.canonical).toBe(b.canonical);
  });
});

describe("a hole", () => {
  /**
   * **Renumbered per declaration**, and without that two identical declarations would hash
   * differently. A hole's index is the BLOCK's, so `color: {{x}}` is hole 0 in one block and hole 1
   * in a block with a declaration above it — same declaration, two canonical texts, two classes, and
   * the dedupe that pays for the whole design gone.
   */
  test("is numbered within its own declaration, not within the block", () => {
    const alone = of("color: {x};")[0];
    // The SECOND hole of its block, so its block index is 1 and its own index is still 0.
    const later = of("background: {a};\ncolor: {b};")[1];

    expect(later.holes).toEqual([1]);
    expect(later.canonical).toBe(alone.canonical);
    expect(alone.holes).toEqual([0]);
  });

  test("and a declaration with two keeps them in order", () => {
    const [one] = of("border-left: {w} solid {c};");

    expect(one.holes).toEqual([0, 1]);
    expect(one.canonical).toBe(of("border-left: {a} solid {b};")[0].canonical);
  });
});

/**
 * A realistic block, taken apart completely — the regression net for everything above at once.
 *
 * **The proof that this is CORRECT is a browser, and it was measured before this was written:** the
 * same block emitted as one whole-block rule and as 14 atomic rules gives byte-identical computed
 * style, hovered, on a narrow viewport and a wide one — display, alignment, gap, padding, both
 * colours, radius, the descendant's weight and its decoration. Nesting, descendants, a combined
 * `&:hover .title`, a `@media` override and a `@media` around a `&:hover` all survive being taken
 * apart. That measurement is recorded in PLAN.md; this asserts the shape it rests on.
 */
describe("a realistic block", () => {
  const REAL = [
    "display: flex;",
    "gap: 8px;",
    "background: #10b981;",
    "&:hover { background: #0e9f6e; color: #f0fdf4; }",
    "& .title { font-weight: 700; }",
    "&:hover .title { text-decoration: underline; }",
    "@media (min-width: 40rem) { padding: 12px 24px; gap: 12px; }",
    "@media (min-width: 40rem) { &:hover { background: #059669; } }",
  ].join("\n");

  test("every declaration comes out once, with the context it was written in", () => {
    expect(of(REAL).map((one) => one.key)).toEqual([
      "display",
      "gap",
      "background",
      "&:hover|background",
      "&:hover|color",
      "& .title|font-weight",
      "&:hover .title|text-decoration",
      "@media (min-width: 40rem)|padding",
      "@media (min-width: 40rem)|gap",
      "@media (min-width: 40rem)|&:hover|background",
    ]);
  });

  test("and the two that set the same thing in different contexts are different keys", () => {
    const found = of(REAL);
    const gaps = found.filter((one) => one.property === "gap");

    expect(gaps).toHaveLength(2);
    expect(gaps[0].key).not.toBe(gaps[1].key);
    // Same property, so the sheet orders them the same way; the CONDITION is what separates them.
    expect(gaps[0].conditions).toEqual([]);
    expect(gaps[1].conditions).toEqual(["@media (min-width: 40rem)"]);
  });
});

/**
 * WHICH at-rules may be SORTED, and it is not all of them.
 *
 * Conditions are sorted so that two authors writing the same two of them in either order share one
 * class — which is the whole win of atomic CSS, and correct for a CONDITIONAL at-rule:
 * `@media A { @supports B { … } }` asks "A and B", and `and` commutes.
 *
 * **A STRUCTURAL at-rule does not ask a question, it places the rule**, and nesting composes it. A
 * review measured both:
 *
 * - `@layer a { @layer b { … } }` is layer `a.b` and the reverse is `b.a` — two different cascade
 *   layers at different priorities, which is what layers are for. Sorted, both authors got one rule
 *   in `a.b`, so the second one's declaration silently lived in the first one's layer.
 * - `@scope (.p) { @scope (.q) { … } }` matches an element inside a `.q` inside a `.p`, and the
 *   reverse matches inside a `.p` inside a `.q`. On one document one of them matches and the other
 *   does not.
 *
 * **An ALLOW-LIST rather than a deny-list**, because the unknown case has to fail safe: an at-rule
 * CSS invents after this is written keeps the order it was written in, which is never wrong and at
 * worst spends a second class where one would do. A deny-list would silently mis-sort it.
 */
describe("which conditions may be sorted", () => {
  const conditionsOf = (css: string) => of(css)[0]?.conditions ?? [];

  test.each([
    ["two @media", "@media print", "@media (min-width: 40rem)"],
    ["@media and @supports", "@media print", "@supports (display: grid)"],
    ["@supports and @container", "@supports (display: grid)", "@container (width > 40rem)"],
  ])("%s sort, so either nesting order is one identity", (_what, outer, inner) => {
    const one = of(`${outer} { ${inner} { color: red; } }`)[0];
    const other = of(`${inner} { ${outer} { color: red; } }`)[0];

    expect(one.conditions).toEqual(other.conditions);
    expect(one.identity).toBe(other.identity);
  });

  test.each([
    ["@layer, where nesting names a child layer", "@layer a { @layer b { color: red; } }", ["@layer a", "@layer b"]],
    ["and the other way round", "@layer b { @layer a { color: red; } }", ["@layer b", "@layer a"]],
    [
      "@scope, where nesting composes the roots",
      "@scope (.p) { @scope (.q) { color: red; } }",
      ["@scope (.p)", "@scope (.q)"],
    ],
    ["and its reverse", "@scope (.q) { @scope (.p) { color: red; } }", ["@scope (.q)", "@scope (.p)"]],
  ])("%s keeps the order it was written in", (_what, css, expected) => {
    expect(conditionsOf(css)).toEqual(expected);
  });

  test("so the two layer orders are two different identities", () => {
    const one = of("@layer a { @layer b { color: red; } }")[0];
    const other = of("@layer b { @layer a { color: red; } }")[0];

    expect(one.identity).not.toBe(other.identity);
    expect(one.key).not.toBe(other.key);
  });

  test("and so are the two scope orders", () => {
    const one = of("@scope (.p) { @scope (.q) { color: red; } }")[0];
    const other = of("@scope (.q) { @scope (.p) { color: red; } }")[0];

    expect(one.identity).not.toBe(other.identity);
  });

  /**
   * MIXED, and the whole set keeps its order. Sorting the sortable ones among themselves would move
   * them past the structural one, which is the thing that may not happen — and answering "no" for
   * the whole set is one rule rather than a per-position argument.
   */
  test("a sortable condition inside a structural one keeps its place", () => {
    expect(conditionsOf("@layer a { @media print { color: red; } }")).toEqual(["@layer a", "@media print"]);
    expect(conditionsOf("@media print { @layer a { color: red; } }")).toEqual(["@media print", "@layer a"]);
  });

  /** An at-rule nobody here has heard of keeps its order too, which is the safe direction. */
  test("an at-rule this list does not know keeps its order", () => {
    expect(conditionsOf("@invented x { @media print { color: red; } }")).toEqual(["@invented x", "@media print"]);
  });
});

/**
 * How narrow a rule is, as a number that sorts — which is the order the stylesheet comes out in.
 *
 * The reason it exists is a fault no author could have found: two breakpoints for one property were
 * both conditional and neither was a shorthand, so they ranked the same, and the sheet fell back to
 * the order the file wrote them in — which another file writing only one of the two then reversed.
 * Measured in Chromium: 280 of 750 load orders wrong. So the width comes off the QUERY now, which is
 * what every atomic CSS framework does.
 */
describe("how narrow a rule is", () => {
  const slot = (...conditions: string[]) => widthSlot(conditions);

  test("nothing conditional is first, whatever else is in the build", () => {
    expect(widthSlot(undefined)).toBe(0);
    expect(widthSlot([])).toBe(0);
  });

  test("a wider `min-width` is later, which is what mobile-first means", () => {
    expect(slot("@media (min-width: 40rem)")).toBeLessThan(slot("@media (min-width: 64rem)"));
  });

  test("a narrower `max-width` is later, which is what desktop-first means", () => {
    expect(slot("@media (max-width: 64rem)")).toBeLessThan(slot("@media (max-width: 40rem)"));
  });

  /** Which of the two wins when both match, and the frameworks all settled on this one. */
  test("every `min-width` is after every `max-width`", () => {
    expect(slot("@media (max-width: 1px)")).toBeLessThan(slot("@media (min-width: 4999px)"));
  });

  test("`px`, `rem` and `em` are the same number", () => {
    expect(slot("@media (min-width: 640px)")).toBe(slot("@media (min-width: 40rem)"));
    expect(slot("@media (min-width: 40em)")).toBe(slot("@media (min-width: 40rem)"));
  });

  /**
   * THE MODES, in Tailwind's own order, which is where the breakpoints sit in the middle.
   *
   * Read out of its `corePlugins.js` rather than invented: reduced motion, the colour scheme and the
   * medium are weaker than a breakpoint; `@supports`, orientation, contrast and `forced-colors` are
   * stronger. **The user chose this over the order I had shipped** — I had every mode beating every
   * breakpoint — and the reason is which mistake stays silent: theming lives in a BASE block and a
   * modifier adjusts at a breakpoint, so `...{base}; @media (min-width: …) { … }` is the shape
   * people write, and mode-wins loses it with nothing able to report it.
   */
  test("the modes are ordered against each other the way Tailwind orders them", () => {
    const order = [
      "@media (prefers-reduced-motion: reduce)",
      "@media (prefers-color-scheme: dark)",
      "@media print",
      "@media (min-width: 40rem)",
      "@supports (display: grid)",
      "@media (orientation: portrait)",
      "@media (prefers-contrast: more)",
      "@media (forced-colors: active)",
    ];

    const slots = order.map((one) => slot(one));
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
    expect(new Set(slots).size).toBe(order.length);
    // And every one of them is after the unconditional rules.
    expect(Math.min(...slots)).toBeGreaterThan(widthSlot([]));
  });

  test.each([
    ["a weaker mode loses to a breakpoint", "@media (prefers-color-scheme: dark)", "@media (min-width: 1px)"],
    ["and the medium does too", "@media print", "@media (min-width: 1px)"],
    ["a stronger one beats it", "@media (min-width: 4999px)", "@media (forced-colors: active)"],
    ["and so does `@supports`", "@media (min-width: 4999px)", "@supports (display: grid)"],
  ])("%s", (_what, weaker, stronger) => {
    expect(slot(weaker)).toBeLessThan(slot(stronger));
  });

  /** A condition the table does not know comes last, where it ties with the others like it. */
  test.each([
    ["@media (min-height: 40rem)", "a query about something else"],
    ["@media (hover: hover)", "a device fact the table does not list"],
    ["@media (min-width: 50ch)", "a width in a unit this cannot read"],
    ["@media (min-width: calc(10px + 1em))", "a width that is an expression"],
  ])("a condition this table cannot place comes last: %s", (condition) => {
    expect(slot(condition)).toBeGreaterThan(slot("@media (forced-colors: active)"));
    expect(slot(condition)).toBe(slot("@media (min-height: 1px)"));
  });

  /** Beyond the widest slot the values are clamped, so nothing wraps past anything else. */
  test("a breakpoint past the widest slot ties rather than wrapping", () => {
    expect(slot("@media (min-width: 9000px)")).toBe(slot("@media (min-width: 99999px)"));
    // Still a breakpoint, so still below the modes that beat one.
    expect(slot("@media (min-width: 9000px)")).toBeLessThan(slot("@media (forced-colors: active)"));
  });

  /** Two conditions around one rule mean it applies only where both hold, so both are read. */
  test("the most restrictive of several conditions is the one that places it", () => {
    expect(slot("@media (min-width: 40rem)", "@media (min-width: 64rem)")).toBe(slot("@media (min-width: 64rem)"));
    expect(slot("@media (max-width: 40rem)", "@media (max-width: 64rem)")).toBe(slot("@media (max-width: 40rem)"));
  });

  /** A band is placed by where it starts: no single number orders two bands that overlap in part. */
  test("a rule with both is placed by its `min-width`", () => {
    expect(slot("@media (min-width: 40rem) and (max-width: 64rem)")).toBe(slot("@media (min-width: 40rem)"));
  });

  /** The rank is this, with the breadth deciding what the width leaves tied. */
  describe("and the rank built on it", () => {
    test("puts a shorthand before its own longhand", () => {
      expect(sheetRank({ property: "margin" })).toBeLessThan(sheetRank({ property: "margin-left" }));
    });

    test("and the width decides before the breadth does", () => {
      const wide = sheetRank({ property: "margin-left", conditions: ["@media (min-width: 64rem)"] });
      const narrow = sheetRank({ property: "margin", conditions: ["@media (min-width: 40rem)"] });
      expect(narrow).toBeLessThan(wide);
    });
  });
});

/**
 * **A BREAKPOINT WRITTEN IN TWO SPELLINGS CSS TREATS AS ONE.**
 *
 * `widthSlot` is the sheet's major order, so a condition it cannot read as a width falls into the
 * "unknown condition" band at the end — which sorts AFTER every breakpoint. Two spellings CSS
 * accepts were landing there, and neither is exotic:
 *
 *     @media (min-width: 40REM)     a CSS unit is case-INSENSITIVE, so this is `40rem`
 *     @media (width >= 40rem)       the range syntax, which is the spelling MDN now recommends
 *
 * Measured in Chromium against plain CSS, two breakpoints on one property in two FILES — where no
 * rule can see both and the layer is the only thing deciding, which is the whole reason the layers
 * exist:
 *
 *     40REM against 80rem       ours rgb(1,1,1)   plain CSS rgb(2,2,2)   wrong in BOTH file orders
 *     width>=40rem vs >=80rem   right when the narrow file loads first, WRONG when the wide one does
 *
 * The second is the fault this scheme was built to prevent: both conditions tie in the unknown band,
 * so the sheet's position decides, so adding an unrelated component moves a page nobody edited.
 *
 * In one file it is loud instead of silent, and wrongly so: `override-out-of-order` fires on
 * `40REM` and explains that the rules are in the wrong ORDER, which is not true — the author is told
 * to move correct CSS, for a reason that is not the reason.
 */
describe("a width written the other ways CSS allows", () => {
  /** The slot `40rem` gets, which every spelling of the same width must also get. */
  const canonical = widthSlot(["@media (min-width: 40rem)"]);

  test.each([
    ["capitals", "@media (min-width: 40REM)"],
    ["mixed case", "@media (min-width: 40Rem)"],
    ["capitals on px", "@media (min-width: 640PX)"],
    ["capitals on em", "@media (min-width: 40EM)"],
  ])("a unit in %s is the same width", (_what, condition) => {
    expect(widthSlot([condition])).toBe(canonical);
  });

  test.each([
    ["greater or equal", "@media (width >= 40rem)"],
    ["strictly greater", "@media (width > 40rem)"],
    ["the value first", "@media (40rem <= width)"],
    ["the value first, strict", "@media (40rem < width)"],
    ["in capitals too", "@media (WIDTH >= 40REM)"],
  ])("the range syntax, %s, is a min-width", (_what, condition) => {
    expect(widthSlot([condition])).toBe(canonical);
  });

  test.each([
    ["less or equal", "@media (width <= 40rem)"],
    ["strictly less", "@media (width < 40rem)"],
    ["the value first", "@media (40rem >= width)"],
  ])("the range syntax, %s, is a max-width", (_what, condition) => {
    expect(widthSlot([condition])).toBe(widthSlot(["@media (max-width: 40rem)"]));
  });

  /** A band written in one condition, which the colon form cannot express at all. */
  test("a two-sided range is both a min and a max", () => {
    const band = widthSlot(["@media (40rem <= width <= 80rem)"]);

    expect(band).toBe(widthSlot(["@media (min-width: 40rem) and (max-width: 80rem)"]));
    expect(widthSlot(["@media (40rem < width < 80rem)"])).toBe(band);
  });

  /**
   * And the ordering the slot exists for: a WIDER `min-width` must sort after a narrower one,
   * whichever spelling either is written in. This is the claim, not the numbers.
   */
  test.each([
    ["both in the range syntax", "@media (width >= 40rem)", "@media (width >= 80rem)"],
    ["a range against a colon", "@media (min-width: 40rem)", "@media (width >= 80rem)"],
    ["a colon against a range", "@media (width >= 40rem)", "@media (min-width: 80rem)"],
    ["capitals against lowercase", "@media (min-width: 40REM)", "@media (min-width: 80rem)"],
    ["lowercase against capitals", "@media (min-width: 40rem)", "@media (min-width: 80REM)"],
  ])("the wider breakpoint sorts last: %s", (_what, narrow, wide) => {
    expect(widthSlot([wide])).toBeGreaterThan(widthSlot([narrow]));
  });

  /**
   * A HEIGHT range is not a width, and neither is a container's own axis — the slot is about width
   * alone, and reading anything with a `>=` in it as one would put an unrelated condition in the
   * breakpoint band.
   */
  test.each(["@media (height >= 40rem)", "@media (aspect-ratio >= 1/1)", "@media (resolution >= 2x)"])(
    "%s is not a width",
    (condition) => {
      expect(widthSlot([condition])).toBeGreaterThan(widthSlot(["@media (min-width: 9999rem)"]));
    },
  );

  /**
   * A unit this cannot resolve is still not a width, which the module's own note promises — and the
   * promise is about `vw` and `ch`, which genuinely depend on something a build cannot know. It was
   * never meant to cover `REM`, which is the same unit in capitals.
   */
  test.each(["@media (min-width: 40vw)", "@media (width >= 40ch)", "@media (min-width: 40)"])(
    "%s has no width to compare",
    (condition) => {
      expect(widthSlot([condition])).toBeGreaterThan(widthSlot(["@media (min-width: 9999rem)"]));
    },
  );
});
