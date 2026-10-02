import { describe, expect, test } from "vitest";
import type { MatchPart, ValuePart } from "../compiler/ast";
import { readBlock } from "../compiler/read";
import { checkBlock } from "../compiler/rules";
import { findBlocks } from "../compiler/scan";
import { Sheet } from "../compiler/sheet";
import { transform } from "../compiler/transform";
import { mergeClassNames, pick } from "../merge";

/**
 * `match`, which turns a value that varies into a choice between values that do not.
 *
 * **It is a lookup table, not pattern matching.** TC39's proposal has destructuring, guards and
 * custom matchers, and none of it is here: the subject is one expression, every arm is a literal,
 * and the answer is one of them. The name is borrowed for how it reads, not for what it promises.
 *
 * What it buys is the whole of why it exists — the arms are known when the block compiles, so each
 * becomes a class and the render only chooses. A hole cannot do that, because its value is the
 * render's.
 */

/** The parts of the first declaration's value. */
function parts(css: string): readonly ValuePart[] {
  const source = `<div className={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const { block } = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  const [first] = block.items;
  if (first === undefined || first.kind !== "declaration") throw new Error("no declaration was read");
  return first.value;
}

/** The single match in a value, which is all a value may hold when it holds one. */
function matched(css: string): MatchPart {
  const found = parts(css).filter((one) => one.kind === "match");
  expect(found).toHaveLength(1);
  return found[0] as MatchPart;
}

describe("reading a match", () => {
  test("the subject is a hole and every arm is read", () => {
    const one = matched(`color: match $(this.variant) {\n  primary => red;\n  secondary => blue;\n}`);

    expect(one.arms.map((arm) => arm.key)).toEqual(["primary", "secondary"]);
    expect(
      one.arms.map((arm) => arm.value.map((part) => (part.kind === "text" ? part.text.trim() : "?")).join("")),
    ).toEqual(["red", "blue"]);
  });

  test("`_` is the default arm and says so", () => {
    const one = matched(`color: match $(this.variant) {\n  primary => red;\n  _ => inherit;\n}`);

    expect(one.arms.map((arm) => arm.otherwise)).toEqual([false, true]);
  });

  test("a key may be a number", () => {
    expect(matched(`grid-column: match $(this.span) {\n  1 => 1;\n  2 => span 2;\n}`).arms.map((a) => a.key)).toEqual([
      "1",
      "2",
    ]);
  });

  test("a key may be quoted, for what is not an identifier", () => {
    expect(matched(`color: match $(this.v) {\n  "extra large" => red;\n}`).arms.map((a) => a.key)).toEqual([
      "extra large",
    ]);
  });

  test("an arm holds a whole value, not one word", () => {
    const one = matched(`border-left: match $(this.tone) {\n  loud => 4px solid red;\n  quiet => 1px dashed grey;\n}`);

    expect(one.arms[0].value.map((part) => (part.kind === "text" ? part.text.trim() : "?")).join("")).toBe(
      "4px solid red",
    );
  });

  test("an arm may name a declared variable", () => {
    const one = matched(`color: match $(this.tone) {\n  loud => $color.accent;\n}`);

    expect(one.arms[0].value.some((part) => part.kind === "variable")).toBe(true);
  });

  test("the value holds the match and nothing else", () => {
    expect(parts(`color: match $(this.v) {\n  a => red;\n}`).filter((one) => one.kind === "text")).toEqual([]);
  });
});

describe("what a match compiles to", () => {
  const compiled = (css: string) => {
    const source = `const a = @@(\n${css}\n);`;
    const out = transform(source, { filename: "Card.tsx" });
    if (out === undefined) throw new Error("the block was not transformed");
    const sheet = new Sheet();
    sheet.add("Card.tsx", out.blocks);
    return { code: out.code, css: sheet.css(), blocks: out.blocks };
  };

  test("every arm is its own rule, so every arm is a class", () => {
    const { css } = compiled(`color: match $(v) { primary => red; secondary => blue; };`);

    expect(css).toContain("color:red;");
    expect(css).toContain("color:blue;");
  });

  /**
   * A match is its own MERGE ARGUMENT, not part of a class string — it is a call that chooses a
   * class while the page renders, and the key it decides for is in whichever class it returns.
   */
  test("and it is one call that chooses between their classes", () => {
    const { code } = compiled(`color: match $(v) { primary => red; secondary => blue; };`);

    expect(code).toContain(`_pick(v,{"primary":"r-c-red","secondary":"r-c-blue",})`);
  });

  test("the `_` arm is the fallback, not a key", () => {
    const { code } = compiled(`color: match $(v) { primary => red; _ => inherit; };`);

    expect(code).toContain(`_pick(v,{"primary":"r-c-red",},"r-c-inherit")`);
  });

  /** A file with no match imports nothing it does not call. */
  test("a block with no match does not import the helper", () => {
    expect(compiled(`color: red;`).code).not.toContain("pick as");
  });

  test("an arm may hold a whole value, and it splits into the longhands it sets", () => {
    const { css } = compiled(`border-left: match $(t) { loud => 4px solid red; quiet => 1px dashed grey; };`);

    expect(css).toContain("border-left-width:4px;");
    expect(css).toContain("border-left-style:solid;");
    expect(css).toContain("border-left-color:red;");
    expect(css).toContain("border-left-style:dashed;");
    expect(css).not.toContain("border-left:");
  });
});

describe("what a match does at run time", () => {
  const chosen = (v: unknown) => mergeClassNames(pick(v, { primary: "r-c-red", secondary: "r-c-blue" }, "r-c-inherit"));

  test("the subject names its arm", () => {
    expect(chosen("primary")).toBe("r-c-red");
    expect(chosen("secondary")).toBe("r-c-blue");
  });

  test("anything else falls to `_`", () => {
    expect(chosen("tertiary")).toBe("r-c-inherit");
    expect(chosen(undefined)).toBe("r-c-inherit");
  });

  /**
   * **With no `_`, nothing applies** — the entry carries no class, the merge skips it, and whatever
   * was set above it stands. That is the answer `when $(false)` already gives, and it is why an arm
   * can be a class at all: every outcome was decided when the block compiled, including this one.
   */
  test("with no `_`, an unmatched subject sets nothing and leaves what was above it", () => {
    expect(mergeClassNames("r-c-grey", pick("tertiary", { primary: "r-c-red" }))).toBe("r-c-grey");
  });

  test("and it holds its identity, because every arm was built before the render", () => {
    expect(chosen("primary")).toBe(chosen("primary"));
  });
});

describe("what a match may not hold", () => {
  const rules = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    return checkBlock(readBlock(source, site.open, "Card.tsx", { tolerant: true }).block).map((one) => one.rule);
  };

  /**
   * **A hole in an arm would put the render's value back where a class belongs**, and the whole
   * reason a match can be a class is that every arm was decided when the block compiled. Refused,
   * or the design leaks through a side door.
   */
  test("a hole in an arm is refused", () => {
    expect(rules(`color: match $(v) { primary => $(this.brand); };`)).toContain("hole-in-a-match-arm");
  });

  test("a hole in the SUBJECT is what a match is, so it is quiet", () => {
    expect(rules(`color: match $(v) { primary => red; };`)).toEqual([]);
  });

  test("two arms with one key are reported, because the second can never be reached", () => {
    expect(rules(`color: match $(v) { primary => red; primary => blue; };`)).toContain("match-arm-repeated");
  });

  test("a `_` written above an arm is reported, because it answers first", () => {
    expect(rules(`color: match $(v) { _ => inherit; primary => red; };`)).toContain("match-arm-repeated");
  });

  test("a match with no arms is refused", () => {
    expect(rules(`color: match $(v) { };`)).toContain("match-with-no-arms");
  });
});

/**
 * A REGISTERED property, set at run time.
 *
 * A block is compiled before the app runs, so a value the app computes cannot be in a class. It goes
 * where CSS puts one: a custom property on the element. `@@property` is how that is declared, and
 * the binding it produces is the generated name — so it reads in the block and goes straight in as
 * a key where the value is set.
 *
 * What `toStyle` adds is the half a string cannot have: the value is checked against the `syntax`
 * the property declared, by the same machinery a declared variable's range already uses.
 */
describe("setting a registered property", () => {
  test("the binding is the generated name, and one property is one name however often it is read", () => {
    const source = `const pad = @@property( syntax: "<length>"; initial-value: 0px; );
const box = @@( padding-left: var($(pad)); padding-right: var($(pad)); );`;
    const out = transform(source, { filename: "Card.tsx" });
    if (out === undefined) throw new Error("not transformed");
    const sheet = new Sheet();
    sheet.add("Card.tsx", out.blocks);

    const names = [...new Set(sheet.css().match(/--r-[A-Za-z0-9]+/g) ?? [])];
    expect(names).toHaveLength(1);
    expect(out.code).toMatch(/const pad = "--r-[A-Za-z0-9]+"/);
  });

  /**
   * The other half of the same argument: a hole could not be shared, and it is refused now.
   *
   * Two declarations wanting one value got two custom properties, because a hole belongs to the
   * declaration it stands in and nothing could tell it two of them meant the same thing. A declared
   * name is one name however many read it — the assertion above — and this is the shape that used to
   * be the alternative.
   */
  test("and a hole, which would have been two names for one value, is refused outright", () => {
    expect(() =>
      transform(`const a = @@( padding-left: $(v); padding-right: $(v); );`, { filename: "Card.tsx" }),
    ).toThrow(/@@property/);
  });
});

/**
 * An arm of a `match` on a SHORTHAND splits like any declaration, and its class is the pieces.
 *
 * It did not: every arm kept its shorthand, so `padding: match(…)` reached the sheet whole, in a
 * layer named by `padding`'s count — the naming that moves when CSS adds a longhand. An arm is
 * chosen at run time, so it cannot be several arguments of the merge; it is ONE string of classes,
 * the family's marker first, and the merge splits it on its spaces like any other.
 */
describe("a match on a shorthand", () => {
  const code = (block: string) =>
    transform(`declare const t: "a" | "b";\nconst x = @@( ${block} );\n`, { filename: "Card.tsx" })?.code ?? "";

  test("each arm is the family's marker and its pieces", () => {
    expect(code("padding: match $(t) { a => 1px; b => 2px 3px; };")).toContain(
      '_pick(t,{"a":"r-p- r-pt-1px r-pr-1px r-pb-1px r-pl-1px","b":"r-p- r-pt-2px r-pr-3px r-pb-2px r-pl-3px",})',
    );
  });

  test("and the otherwise arm too", () => {
    expect(code("padding: match $(t) { a => 1px; _ => 0; };")).toContain(',"r-p- r-pt-0 r-pr-0 r-pb-0 r-pl-0")');
  });

  test("an arm that cannot split keeps its shorthand, and the others still split", () => {
    expect(code("padding: match $(t) { a => var(--p); b => 1px; };")).toContain(
      '_pick(t,{"a":"r-p-var(--p)","b":"r-p- r-pt-1px r-pr-1px r-pb-1px r-pl-1px",})',
    );
  });

  test("and the merge takes an arm's classes like any others", () => {
    const merged = String(mergeClassNames("r-pl-40px", pick("a", { a: "r-p- r-pt-1px r-pr-1px r-pb-1px r-pl-1px" })));
    expect(merged.split(" ")).not.toContain("r-pl-40px");
    expect(merged.split(" ")).toContain("r-pl-1px");
  });
});
