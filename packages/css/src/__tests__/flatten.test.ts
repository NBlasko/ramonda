import { describe, expect, test } from "vitest";
import { flatten } from "../compiler/flatten";
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

    expect(one.selector).toBe(":hover");
    expect(one.key).toBe(":hover|background");
  });

  test("a descendant keeps its space, because that is what it means", () => {
    expect(of("& .title { color: red; }")[0].selector).toBe(" .title");
  });

  test("and a bare selector is a descendant too, which is what CSS nesting says", () => {
    expect(of(".title { color: red; }")[0].selector).toBe(" .title");
  });

  test("nested twice composes, in order", () => {
    expect(of("& .title { &:hover { color: red; } }")[0].selector).toBe(" .title:hover");
    expect(of("&:hover { & .title { color: red; } }")[0].selector).toBe(":hover .title");
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
    const alone = of("color: {{x}};")[0];
    // The SECOND hole of its block, so its block index is 1 and its own index is still 0.
    const later = of("background: {{a}};\ncolor: {{b}};")[1];

    expect(later.holes).toEqual([1]);
    expect(later.canonical).toBe(alone.canonical);
    expect(alone.holes).toEqual([0]);
  });

  test("and a declaration with two keeps them in order", () => {
    const [one] = of("border-left: {{w}} solid {{c}};");

    expect(one.holes).toEqual([0, 1]);
    expect(one.canonical).toBe(of("border-left: {{a}} solid {{b}};")[0].canonical);
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
      ":hover|background",
      ":hover|color",
      " .title|font-weight",
      ":hover .title|text-decoration",
      "@media (min-width: 40rem)|padding",
      "@media (min-width: 40rem)|gap",
      "@media (min-width: 40rem)|:hover|background",
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
