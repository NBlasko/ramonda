import { describe, expect, test } from "vitest";
import { HOLE, normalise } from "../compiler/normalise";
import { readBlock } from "../compiler/read";
import { transform } from "../compiler/transform";

/**
 * A hole spelled with ONE brace, and a condition parenthesised — the spelling decided 2026-09-07.
 *
 * `{{ … }}` was chosen when the language had no other use for the shape, and it reads worst exactly
 * where it is densest: four levels of delimiter for one value. One brace is also the escape JSX
 * already puts in the same place, `css={@@( … )}`, so a reader meets one bracket convention.
 *
 * ## Why the condition gains parentheses rather than losing braces
 *
 * `@@if {this.off} {` puts two brackets of different kinds one space apart, and `} {` reads as a
 * close and an open at the same level. `@@if ({this.off}) {` separates them with the `)`, which is
 * the shape every conditional at-rule in CSS already has — `@media (…) {`, `@supports (…) {`. And it
 * costs nothing: `@@if {{this.off}}` and `@@if ({this.off})` are both 17 characters.
 *
 * It also keeps the language's one standing rule, which is the reason `@@if (expr)` was refused when
 * this was first decided: **TypeScript appears inside braces and nowhere else.** The parentheses are
 * the at-rule's head, not the expression.
 *
 * ## The three places a `{` at depth zero is a hole and not a rule
 *
 * Measured against every real prelude in this repository — 15 blocks, 12 distinct preludes, none
 * misread:
 *
 * - at the very START of an item, which is a hole in a property NAME. A prelude cannot begin with
 *   `{`, because that would be an empty selector.
 * - after exactly `<name>:` and whitespace, which is a value. A selector cannot END in a colon, so
 *   `&:hover`, `@media (min-width: 40rem)` and `&[data-x="y"]` are all unambiguous.
 * - after exactly `...`, which is a spread.
 *
 * A condition needs no case of its own: `(` raises the depth, so the hole inside it is never at
 * depth zero and the question does not arise.
 */
const canonical = (source: string) =>
  normalise(readBlock(source, 2, "C.tsx").block)
    .split(HOLE)
    .join("@");

describe("a hole is one brace", () => {
  test("in a value", () => {
    expect(canonical(`@@(\n  color: {accent};\n)`)).toBe("color:@0@;");
  });

  /**
   * A hole in a property NAME is allowed only where it resolves — a `@@property( … )` declared in
   * this file. Unresolved it is refused, and that predates this change: a custom property holds a
   * value, so a hole cannot BE a declaration.
   */
  test("in a property name, where it names a registered property", () => {
    const source = `@@(\n  {accent}: #34d399;\n)`;
    const read = readBlock(source, 2, "C.tsx", { resolve: (name) => (name === "accent" ? "--r-x" : undefined) });

    expect(normalise(read.block)).toBe("--r-x:#34d399;");
  });

  test("and unresolved it is still refused, which is the older rule", () => {
    expect(() => readBlock(`@@(\n  {accent}: #34d399;\n)`, 2, "C.tsx")).toThrow(/cannot be a whole declaration/);
  });

  test("beside static text in the same value", () => {
    expect(canonical(`@@(\n  border: 4px solid {accent};\n)`)).toBe("border:4px solid @0@;");
  });

  test("more than one in a block, numbered in source order", () => {
    expect(canonical(`@@(\n  color: {a};\n  background: {b};\n)`)).toBe("color:@0@;background:@1@;");
  });

  test("holding an expression with braces of its own", () => {
    expect(canonical(`@@(\n  color: {pick({ tone: 1 })};\n)`)).toBe("color:@0@;");
  });

  test("holding a template literal", () => {
    expect(canonical("@@(\n  padding: {`${this.weight}px`};\n)")).toBe("padding:@0@;");
  });
});

describe("and a nested rule is still a nested rule", () => {
  const items = (source: string) => readBlock(source, 2, "C.tsx").block.items.map((one) => one.kind);
  const prelude = (source: string) => {
    const [item] = readBlock(source, 2, "C.tsx").block.items;
    return item.kind === "rule" ? item.prelude : "(not a rule)";
  };

  test.each([
    ["&:hover", `@@(\n  &:hover {\n    color: red;\n  }\n)`],
    ["& .title", `@@(\n  & .title {\n    color: red;\n  }\n)`],
    ["&::after", `@@(\n  &::after {\n    content: "";\n  }\n)`],
    ['&[data-urgent="true"]', `@@(\n  &[data-urgent="true"] {\n    color: red;\n  }\n)`],
    ["&:hover, &:focus-within", `@@(\n  &:hover, &:focus-within {\n    color: red;\n  }\n)`],
    ["@media (min-width: 40rem)", `@@(\n  @media (min-width: 40rem) {\n    color: red;\n  }\n)`],
  ])("%s", (expected, source) => {
    expect(items(source)).toEqual(["rule"]);
    expect(prelude(source)).toBe(expected);
  });

  test("a rule and a hole in the same block, one after the other", () => {
    expect(items(`@@(\n  color: {accent};\n  &:hover {\n    color: red;\n  }\n)`)).toEqual(["declaration", "rule"]);
  });
});

describe("a condition is parenthesised", () => {
  const prelude = (source: string) => {
    const [item] = readBlock(source, 2, "C.tsx").block.items;
    return item.kind === "rule" ? item.prelude : "(not a rule)";
  };

  test("the head is read as a condition", () => {
    expect(prelude(`@@(\n  @@if ({this.off}) {\n    opacity: 0.5;\n  }\n)`)).toContain("@@if");
  });

  test("it compiles to a guarded group", () => {
    const out = transform(`const s = @@(\n  @@if ({this.off}) {\n    opacity: 0.5;\n  }\n);\n`, {
      filename: "C.tsx",
    });

    expect(out?.code).toContain("this.off");
  });

  test("and a spread needs no parentheses, because it is not an at-rule head", () => {
    const out = transform(`const s = @@(\n  ...{base};\n  color: red;\n);\n`, { filename: "C.tsx" });

    expect(out?.code).toContain("base");
  });
});
