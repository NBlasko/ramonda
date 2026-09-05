import { describe, expect, test } from "vitest";
import { transform } from "../compiler/transform";

/**
 * Composition as the author writes it: inside the block, with **later winning**.
 *
 * That rule is the one a CSS reader already has, and it is the whole reason composition lives here
 * rather than in an array at the call site — there is no array index to map onto precedence, and the
 * thing that overrides sits under the thing it overrides.
 *
 * Two spellings, and both compile to an argument of the same merge:
 *
 * - `...{{expr}};` merges another block's map at that point;
 * - `@@if {{expr}} { … }` merges a group only when the condition holds.
 *
 * `@@if` rather than `@if` because **`@@anything` is structurally impossible in CSS** — an
 * at-keyword is `@` followed by an ident-token and an ident cannot begin with `@` — so it is a
 * grammar guarantee rather than a bet on what CSS will not take. And the condition is inside `{{ }}`
 * because that is this language's one standing rule: TypeScript appears there and nowhere else.
 */
const emit = (source: string) => transform(source, { filename: "Card.tsx" })?.code ?? "";

describe("a spread", () => {
  test("becomes an argument of the merge, in the position it was written", () => {
    const out = emit(`const card = @@(\n  ...{{base}};\n  opacity: 0.5;\n);\n`);

    expect(out).toMatch(/_merge\(base,\s*\{"opacity":"r-[0-9a-f]{16}",\}\)/);
  });

  test("what is written above it merges first, which is what later-wins means", () => {
    const out = emit(`const card = @@(\n  display: flex;\n  ...{{base}};\n);\n`);

    expect(out).toMatch(/_merge\(\{"display":"r-[0-9a-f]{16}",\},\s*base\)/);
  });

  test("the expression is the author's own, byte for byte", () => {
    const out = emit(`const card = @@(\n  ...{{variants[this.variant]}};\n);\n`);

    expect(out).toContain("variants[this.variant]");
  });

  test("and a block holding one is never hoisted, because it is not a constant", () => {
    const out = emit(`const card = @@(\n  ...{{base}};\n);\n`);

    expect(out).not.toContain("const _s0 =");
  });
});

describe("a conditional group", () => {
  test("becomes an argument guarded by its condition", () => {
    const out = emit(
      `const card = @@(\n  cursor: pointer;\n  @@if {{this.off}} {\n    cursor: not-allowed;\n  }\n);\n`,
    );

    expect(out).toMatch(/_merge\(\{"cursor":"r-[0-9a-f]{16}",\},\s*this\.off && \{"cursor":"r-[0-9a-f]{16}",\}\)/);
  });

  test("the two `cursor` entries are different classes, so the merge has something to choose", () => {
    const out = emit(`const card = @@(\n  cursor: pointer;\n  @@if {{this.off}} { cursor: not-allowed; }\n);\n`);
    const found = out.match(/r-[0-9a-f]{16}/g) ?? [];

    expect(new Set(found).size).toBe(2);
  });

  test("a nested group is a conjunction, because that is what nesting means", () => {
    const out = emit(`const card = @@(\n  @@if {{a}} {\n    @@if {{b}} { opacity: 0.5; }\n  }\n);\n`);

    expect(out).toMatch(/_merge\(a && b && \{"opacity":"r-[0-9a-f]{16}",\}\)/);
  });

  test("declarations around a group keep their place", () => {
    const out = emit(`const card = @@(\n  color: red;\n  @@if {{c}} { color: blue; }\n  background: white;\n);\n`);
    const args = out.slice(out.indexOf("_merge("));

    expect(args.indexOf('"color"')).toBeLessThan(args.indexOf("c &&"));
    expect(args.indexOf("c &&")).toBeLessThan(args.indexOf('"background"'));
  });

  test("a selector inside a group is still a selector on its own rule", () => {
    const out = emit(`const card = @@(\n  @@if {{c}} {\n    &:hover { color: red; }\n  }\n);\n`);

    expect(out).toMatch(/c && \{":hover\|color":"r-[0-9a-f]{16}",\}/);
  });

  test("and a group inside a selector means the same thing", () => {
    const inside = emit(`const card = @@(\n  &:hover {\n    @@if {{c}} { color: red; }\n  }\n);\n`);
    const around = emit(`const card = @@(\n  @@if {{c}} {\n    &:hover { color: red; }\n  }\n);\n`);

    expect(inside.match(/r-[0-9a-f]{16}/)?.[0]).toBe(around.match(/r-[0-9a-f]{16}/)?.[0]);
  });
});

describe("the two together", () => {
  test("compose in the order they were written", () => {
    const out = emit(`const card = @@(\n  ...{{base}};\n  @@if {{this.off}} { opacity: 0.5; }\n  width: 100%;\n);\n`);
    const args = out.slice(out.indexOf("_merge("));

    expect(args.indexOf("base")).toBeLessThan(args.indexOf("this.off &&"));
    expect(args.indexOf("this.off &&")).toBeLessThan(args.indexOf('"width"'));
  });
});
