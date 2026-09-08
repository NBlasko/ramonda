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

/**
 * A CSS COMMENT anywhere in the head, which the lookahead did not read as one.
 *
 * `looksLikeARule` decides whether an item is a nested rule or a declaration by which of `{` and `;`
 * comes first at depth zero. It stepped over strings, parens and holes, and **not comments** — while
 * `skipTrivia`, `readHead` and `readValue` all handle them. Three faults came out of that one gap,
 * and a review found them:
 *
 * A commented-out `focus;` in a prelude was read as a DECLARATION, and it EMITTED. A commented-out
 * brace in a value made strict REFUSE valid CSS. And a comment between a property and its colon
 * made the two readers DISAGREE, so a legal declaration was refused as a hole in a selector.
 *
 * The first is the loud one: the block compiled and the module it emitted was a syntax error, so a
 * bundler reported a parse failure in generated code at no line the author had written.
 *
 * The third is this repository's recurring fault in one function: the lookahead asked `opensAHole`
 * with the RAW source slice and the head reader asked it with the text it had already built, in
 * which every comment is one space. The comment above the call claimed they could not disagree.
 */
describe("a comment in the head", () => {
  const items = (source: string) => readBlock(source, 2, "C.tsx").block.items.map((one) => one.kind);
  const prelude = (source: string) => {
    const [item] = readBlock(source, 2, "C.tsx").block.items;
    return item.kind === "rule" ? item.prelude : "(not a rule)";
  };

  /** Each of these characters ended the lookahead's scan while it sat inside a comment. */
  test.each([
    ["a semicolon", `@@(\n  &:hover /* was focus; */ {\n    color: blue;\n  }\n)`],
    ["a closing paren", `@@(\n  &:hover /* ) */ {\n    color: blue;\n  }\n)`],
    ["an opening paren", `@@(\n  &:hover /* ( */ {\n    color: blue;\n  }\n)`],
    ["a brace", `@@(\n  &:hover /* { */ {\n    color: blue;\n  }\n)`],
    ["nothing special", `@@(\n  &:hover /* see #12 */ {\n    color: blue;\n  }\n)`],
  ])("%s in a rule's prelude leaves it a rule", (_what, source) => {
    expect(items(source)).toEqual(["rule"]);
    expect(prelude(source)).toBe("&:hover");
  });

  test("and the rule's body is the body, not a hole's expression", () => {
    const [item] = readBlock(`@@(\n  &:hover /* was focus; */ {\n    color: blue;\n  }\n)`, 2, "C.tsx").block.items;

    expect(item.kind === "rule" && normalise({ items: item.items })).toBe("color:blue;");
  });

  /** The other direction: a `{` inside a comment is not a hole opening, and strict must not refuse. */
  test.each([
    ["a brace in a value's comment", `@@(\n  color: red /* { */;\n)`, "color:red;"],
    ["a brace and its partner", `@@(\n  color: red /* {} */;\n)`, "color:red;"],
    ["before the colon", `@@(\n  color/*x*/: red;\n)`, "color:red;"],
  ])("%s is read, not refused", (_what, source, expected) => {
    expect(normalise(readBlock(source, 2, "C.tsx").block)).toBe(expected);
  });

  /**
   * The two readers agreeing, which is the finding under the other two. A comment beside the colon
   * made the lookahead say "rule" and the head reader say "hole", so a legal declaration was
   * refused as a hole in a selector.
   */
  test.each([
    ["after the property name", `@@(\n  color/*x*/: {accent};\n)`],
    ["after the colon", `@@(\n  color:/*x*/ {accent};\n)`],
    ["both sides", `@@(\n  color/*a*/:/*b*/ {accent};\n)`],
  ])("a hole in a value with a comment %s", (_what, source) => {
    expect(canonical(source)).toBe("color:@0@;");
  });
});

/**
 * A property NAME the regex refused, which made the hole after it a nested rule.
 *
 * `A_DECLARATION` required an ASCII letter first, or `--` and then a letter. So a vendor-prefixed
 * property carrying a hole was read as a rule whose prelude was the declaration — and a vendor
 * prefix in a property is ordinary CSS, not an exotic case. A review found it; `-webkit-mask: none`
 * with no hole in it always parsed, which is why nothing noticed.
 */
describe("a property name that does not start with a letter", () => {
  test.each([
    ["a vendor prefix", `@@(\n  -webkit-mask: {m};\n)`, "-webkit-mask:@0@;"],
    ["another", `@@(\n  -moz-appearance: {a};\n)`, "-moz-appearance:@0@;"],
    ["a custom property starting with a digit", `@@(\n  --2x: {v};\n)`, "--2x:@0@;"],
    ["a custom property starting with an underscore", `@@(\n  --_x: {v};\n)`, "--_x:@0@;"],
    ["a custom property with a letter CSS allows and ASCII does not", `@@(\n  --héllo: {v};\n)`, "--héllo:@0@;"],
  ])("%s takes a hole for its value", (_what, source, expected) => {
    expect(canonical(source)).toBe(expected);
  });

  /** And the same names with no hole, which is what worked all along. */
  test("a vendor-prefixed property with an ordinary value, which never broke", () => {
    expect(normalise(readBlock(`@@(\n  -webkit-mask: none;\n)`, 2, "C.tsx").block)).toBe("-webkit-mask:none;");
  });
});

/**
 * `@@if` with more than one space before its parenthesis.
 *
 * The head reader compared the text to `"@@if ("` and `"@@if("` by EQUALITY, while the hole reader
 * allows whitespace on both sides of everything else. So two spaces, a tab or a newline turned a
 * condition into *a hole cannot stand in a selector* — a refusal naming the wrong thing, on code
 * whose only fault was its spacing. A review found it.
 */
describe("whitespace before a condition's parenthesis", () => {
  test.each([
    ["one space, which always worked", `@@(\n  @@if ({this.roomy}) {\n    color: red;\n  }\n)`],
    ["none, which also worked", `@@(\n  @@if({this.roomy}) {\n    color: red;\n  }\n)`],
    ["two spaces", `@@(\n  @@if  ({this.roomy}) {\n    color: red;\n  }\n)`],
    ["a tab", `@@(\n  @@if\t({this.roomy}) {\n    color: red;\n  }\n)`],
    ["a newline", `@@(\n  @@if\n  ({this.roomy}) {\n    color: red;\n  }\n)`],
  ])("%s", (_what, source) => {
    const [item] = readBlock(source, 2, "C.tsx").block.items;

    expect(item.kind).toBe("rule");
    expect(item.kind === "rule" && normalise({ items: item.items })).toBe("color:red;");
  });
});
