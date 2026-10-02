import { describe, expect, test } from "vitest";
import { HOLE, normalise } from "../compiler/normalise";
import { closingHole, readBlock } from "../compiler/read";
import { checkSource } from "../compiler/source";
import { transform } from "../compiler/transform";

/**
 * A hole spelled with ONE brace, and a condition parenthesised — the spelling decided 2026-09-07.
 *
 * `$(…)` was chosen when the language had no other use for the shape, and it reads worst exactly
 * where it is densest: four levels of delimiter for one value. One brace is also the escape JSX
 * already puts in the same place, `css={@@( … )}`, so a reader meets one bracket convention.
 *
 * ## Why the condition gains parentheses rather than losing braces
 *
 * `if {this.off} {` puts two brackets of different kinds one space apart, and `} {` reads as a
 * close and an open at the same level. `when $(this.off) {` separates them with the `)`, which is
 * the shape every conditional at-rule in CSS already has — `@media (…) {`, `@supports (…) {`. And it
 * costs nothing: `if $(this.off)` and `when $(this.off)` are both 17 characters.
 *
 * It also keeps the language's one standing rule, which is the reason `if (expr)` was refused when
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

/**
 * A BLOCK INSIDE A TEMPLATE LITERAL'S `${ … }`, which compiles to nothing at all.
 *
 * A template literal is a quiet region to the scan — a `(` in one closes nothing and a `@@` in one
 * is text — so a block written in a substitution is found by nothing: the file is handed on
 * untouched, `@@(` survives into the bundler, and the author gets a syntax error somewhere else
 * entirely, naming neither the block nor the line.
 *
 * **It became reachable when the `css` prop went.** A block is a string and goes on `className`, so
 * joining one with a class of the author's own is an ordinary thing to want, and a template is the
 * first thing anybody reaches for. Measured across every position a block can be written in —
 * attribute, assignment, call argument, object value, array element, `return`, arrow body, ternary —
 * a template substitution is the only one that finds nothing.
 */
describe("a block inside a template literal", () => {
  const rules = (source: string) => checkSource(source, "C.tsx").map((one) => one.rule);

  test("is reported, because nothing else would say a word about it", () => {
    expect(rules("const a = <div className={`lead ${@@( color: red; )}`}>x</div>;")).toEqual(["block-in-a-template"]);
  });

  test("and the message names the spelling that works", () => {
    const [only] = checkSource("const a = <div className={`lead ${@@( color: red; )}`}>x</div>;", "C.tsx");

    expect(only.message).toContain("merge");
    expect(only.message).toContain("className={mergeClassNames(");
  });

  /** `merge` in a call argument IS found — measured, along with every other position. */
  test("while the same block in a call argument is compiled and quiet", () => {
    expect(rules('const a = <div className={mergeClassNames(@@( color: red; ), "lead")}>x</div>;')).toEqual([]);
  });

  test.each([
    ["a template holding no block", "const a = `lead ${name}`;"],
    ["a template's own TEXT, which is not a substitution", "const a = `@@( color: red; )`;"],
    ["a string that merely looks like one", 'const a = "${@@( x )}";'],
  ])("%s is not reported", (_what, source) => {
    expect(rules(source)).toEqual([]);
  });

  /**
   * And a template that is legitimately INSIDE a block, which is every expression a block still
   * holds: a condition, a `match` subject, a spread. A brace there is the author's own TypeScript
   * and has nothing to do with this rule.
   */
  test.each([
    ["a template in a condition", "const a = @@( when $(`${x}`) { color: red; } );"],
    ["a template in a match subject", "const a = @@( color: match $(`${x}`) { a => red; }; );"],
    ["a template beside a block", "const a = @@( color: red; );\nconst b = `lead ${a}`;"],
  ])("%s is not reported either", (_what, source) => {
    expect(rules(source)).not.toContain("block-in-a-template");
  });

  /** And the BUILD refuses it, or the check would be the only thing that knew. */
  test("the build refuses it rather than handing `@@(` to a bundler", () => {
    expect(() =>
      transform("const a = <div className={`lead ${@@( color: red; )}`}>x</div>;", { filename: "C.tsx" }),
    ).toThrow(/merge/);
  });
});

describe("a hole is one brace", () => {
  test("in a value", () => {
    expect(canonical(`@@(\n  color: $(accent);\n)`)).toBe("color:@0@;");
  });

  /**
   * A hole in a property NAME is allowed only where it resolves — a `@@property( … )` declared in
   * this file. Unresolved it is refused, and that predates this change: a custom property holds a
   * value, so a hole cannot BE a declaration.
   */
  test("in a property name, where it names a registered property", () => {
    const source = `@@(\n  $(accent): #34d399;\n)`;
    const read = readBlock(source, 2, "C.tsx", { resolve: (name) => (name === "accent" ? "--r-x" : undefined) });

    expect(normalise(read.block)).toBe("--r-x:#34d399;");
  });

  test("and unresolved it is still refused, which is the older rule", () => {
    expect(() => readBlock(`@@(\n  $(accent): #34d399;\n)`, 2, "C.tsx")).toThrow(/cannot be a whole declaration/);
  });

  test("beside static text in the same value", () => {
    expect(canonical(`@@(\n  border: 4px solid $(accent);\n)`)).toBe("border:4px solid @0@;");
  });

  test("more than one in a block, numbered in source order", () => {
    expect(canonical(`@@(\n  color: $(a);\n  background: $(b);\n)`)).toBe("color:@0@;background:@1@;");
  });

  test("holding an expression with braces of its own", () => {
    expect(canonical(`@@(\n  color: $(pick({ tone: 1 }));\n)`)).toBe("color:@0@;");
  });

  test("holding a template literal", () => {
    expect(canonical("@@(\n  padding: $(`${this.weight}px`);\n)")).toBe("padding:@0@;");
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
    expect(items(`@@(\n  color: $(accent);\n  &:hover {\n    color: red;\n  }\n)`)).toEqual(["declaration", "rule"]);
  });
});

/**
 * THE SPELLING, and why it is a word rather than a sigil.
 *
 * `@@if` was the one place `@@` appeared INSIDE a block, which made the marker mean two things — an
 * entrance and a keyword. Inside a block the language is already its own and spells itself without a
 * sigil: `$(expr)` is a hole and `...$(expr)` a spread, both borrowed from JavaScript. `if (…)` is that
 * rule extended rather than an exception to it.
 *
 * **Measured in Chromium 151 before the change.** A bare word followed by PARENS is not a shape CSS
 * has: `if (x) { … }` in a prelude is dropped, because a type selector may not take parentheses and
 * a functional pseudo-class needs its colon — and every conditional CSS ever added carries an `@`.
 * The `if()` of CSS Values 5 is a VALUE function, after the colon, a different position entirely.
 *
 * It also removes a collision the old spelling had: `@@when $(on)` with no space was read as a named
 * SITE called `if`, and refused as *a block cannot contain another block* — a message about the
 * wrong thing, one keystroke away.
 */
describe("the conditional group's spelling", () => {
  const of = (css: string) => {
    try {
      transform(`const s = @@(\n${css}\n);\n`, { filename: "C.tsx" });
      return "compiled";
    } catch (error) {
      return (error as Error).message.split("  ")[1] ?? "";
    }
  };

  test.each([
    ["a space before the paren", "  when $(on) { color: red; }"],
    ["none at all", "  when $(on) { color: red; }"],
  ])("%s compiles", (_what, css) => {
    expect(of(css)).toBe("compiled");
  });

  /**
   * A prelude the parser must NOT read as a guard. `iframe` starts with the marker's letters, and the
   * first version of this tested `startsWith` — which reported valid CSS. A false report is the one
   * thing the reader may not produce.
   */
  test.each([
    ["a selector that starts with the same letters", "  iframe { color: red; }"],
    ["one that only contains them", "  .notify { color: red; }"],
    ["the element named explicitly", "  & if { color: red; }"],
  ])("%s is a selector", (_what, css) => {
    expect(of(css)).toBe("compiled");
  });

  test.each([
    ["a condition that is not code", "  when dark { color: red; }", "`when` takes one `$( … )`"],
    ["no condition at all", "  when { color: red; }", "`when` takes one `$( … )`"],
    ["two conditions", "  when $(a) $(b) { color: red; }", "`when` takes one `$( … )`"],
    // An element named `when` cannot exist — a custom element's name must contain a hyphen — so this
    // costs nobody anything, and it catches the `$( )` somebody forgot.
    ["a class on it", "  when.active { color: red; }", "`when` takes one `$( … )`"],
  ])("%s is refused", (_what, css, says) => {
    expect(of(css)).toContain(says);
  });

  /** And the OLD spellings say what they became, rather than failing as something else. */
  test.each([
    ["`@@if`", "  @@if ($(on)) { color: red; }"],
    ["`if`", "  if ($(on)) { color: red; }"],
    ["`if` with the old braces", "  if ({on}) { color: red; }"],
  ])("%s names what it became", (_what, css) => {
    expect(of(css)).toContain("a condition is written `when $( … )");
  });
});

describe("a condition is parenthesised", () => {
  const prelude = (source: string) => {
    const [item] = readBlock(source, 2, "C.tsx").block.items;
    return item.kind === "rule" ? item.prelude : "(not a rule)";
  };

  test("the head is read as a condition", () => {
    expect(prelude(`@@(\n  when $(this.off) {\n    opacity: 0.5;\n  }\n)`)).toMatch(/^when /);
  });

  test("it compiles to a guarded group", () => {
    const out = transform(`const s = @@(\n  when $(this.off) {\n    opacity: 0.5;\n  }\n);\n`, {
      filename: "C.tsx",
    });

    expect(out?.code).toContain("this.off");
  });

  test("and a spread needs no parentheses, because it is not an at-rule head", () => {
    const out = transform(`const s = @@(\n  ...$(base);\n  color: red;\n);\n`, { filename: "C.tsx" });

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
    ["after the property name", `@@(\n  color/*x*/: $(accent);\n)`],
    ["after the colon", `@@(\n  color:/*x*/ $(accent);\n)`],
    ["both sides", `@@(\n  color/*a*/:/*b*/ $(accent);\n)`],
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
    ["a vendor prefix", `@@(\n  -webkit-mask: $(m);\n)`, "-webkit-mask:@0@;"],
    ["another", `@@(\n  -moz-appearance: $(a);\n)`, "-moz-appearance:@0@;"],
    ["a custom property starting with a digit", `@@(\n  --2x: $(v);\n)`, "--2x:@0@;"],
    ["a custom property starting with an underscore", `@@(\n  --_x: $(v);\n)`, "--_x:@0@;"],
    ["a custom property with a letter CSS allows and ASCII does not", `@@(\n  --héllo: $(v);\n)`, "--héllo:@0@;"],
  ])("%s takes a hole for its value", (_what, source, expected) => {
    expect(canonical(source)).toBe(expected);
  });

  /** And the same names with no hole, which is what worked all along. */
  test("a vendor-prefixed property with an ordinary value, which never broke", () => {
    expect(normalise(readBlock(`@@(\n  -webkit-mask: none;\n)`, 2, "C.tsx").block)).toBe("-webkit-mask:none;");
  });
});

/**
 * `if` with more than one space before its parenthesis.
 *
 * The head reader compared the text to `"if ("` and `"if("` by EQUALITY, while the hole reader
 * allows whitespace on both sides of everything else. So two spaces, a tab or a newline turned a
 * condition into *a hole cannot stand in a selector* — a refusal naming the wrong thing, on code
 * whose only fault was its spacing. A review found it.
 */
describe("whitespace before a condition's parenthesis", () => {
  test.each([
    ["one space, which always worked", `@@(\n  when $(this.roomy) {\n    color: red;\n  }\n)`],
    ["none, which also worked", `@@(\n  when $(this.roomy) {\n    color: red;\n  }\n)`],
    ["two spaces", `@@(\n  when $(this.roomy) {\n    color: red;\n  }\n)`],
    ["a tab", `@@(\n  when\t$(this.roomy) {\n    color: red;\n  }\n)`],
    ["a newline", `@@(\n  when\n  $(this.roomy) {\n    color: red;\n  }\n)`],
  ])("%s", (_what, source) => {
    const [item] = readBlock(source, 2, "C.tsx").block.items;

    expect(item.kind).toBe("rule");
    expect(item.kind === "rule" && normalise({ items: item.items })).toBe("color:red;");
  });
});

/**
 * A REGEX LITERAL inside a hole, whose delimiters `closingHole` counted.
 *
 * The function counts braces, parens, brackets, strings, template literals and both comment forms.
 * It did not know a regex, so a `}` or a `{` inside `/…/` closed the hole early:
 *
 *     css=@@( content: $(s.replace(/}/g, "")); ) ->  this hole is never closed
 *
 * A review found it and the doc comment was corrected to admit it. This is the code catching up.
 *
 * **It is not a JavaScript lexer, and it does not need to be.** Whether a `/` divides or opens a
 * regex is decided by the PREVIOUS significant token, which is a small closed question: after an
 * identifier, a number, `)`, `]`, `}` or a `++`/`--` it divides; after anything else — `(`, `,`,
 * `=`, `:`, `[`, an operator, a keyword like `return`, or the very start — it opens one. The three
 * shapes worth planting a test for are an escaped delimiter, a delimiter inside a character class,
 * and division right after a `)`, which must NOT be read as a regex.
 */
describe("a regex literal in a hole", () => {
  const value = canonical;
  /** The expression the hole recorded, which is what the transform will emit verbatim. */
  const expression = (block: string) => {
    const [span] = readBlock(block, 2, "C.tsx").holes;
    return block.slice(span.start, span.end);
  };

  test.each([
    ["a closing brace as the pattern", `@@(\n  content: $(s.replace(/}/g, ""));\n)`],
    ["an opening brace", `@@(\n  content: $(s.replace(/{/g, ""));\n)`],
    ["both, unbalanced", `@@(\n  content: $(s.replace(/}{/g, ""));\n)`],
    ["a closing paren, escaped", `@@(\n  content: $(s.replace(/\\)/g, ""));\n)`],
    ["a closing paren inside a character class", `@@(\n  content: $(s.split(/[)]/)[0]);\n)`],
    ["an escaped delimiter before one", `@@(\n  content: $(s.replace(/\\/)/g, ""));\n)`],
    ["a bracket", `@@(\n  content: $(s.replace(/]/g, ""));\n)`],
    ["flags after it", `@@(\n  content: $(s.replace(/[)]/gimsuy, ""));\n)`],
    ["a regex holding a quote, which is not a string", `@@(\n  content: $(s.replace(/"[)]/g, ""));\n)`],
    ["one holding what looks like a comment", `@@(\n  content: $(s.replace(/\\/*[)]/g, ""));\n)`],
  ])("%s is part of the expression, not the end of the hole", (_what, block) => {
    expect(value(block)).toBe("content:@0@;");
  });

  test("the expression recorded is the whole of it", () => {
    expect(expression(`@@(\n  content: $(s.replace(/[)]/g, ""));\n)`)).toBe(`s.replace(/[)]/g, "")`);
  });

  /**
   * DIVISION, which must keep working — and each of these would become a regex under a rule that
   * only looked at the slash.
   */
  test.each([
    ["after a paren", `@@(\n  width: $((a + b) / c);\n)`],
    ["after an identifier", `@@(\n  width: $(a / b);\n)`],
    ["after a number", `@@(\n  width: $(1 / 2);\n)`],
    ["after a bracket", `@@(\n  width: $(xs[0] / 2);\n)`],
    ["twice", `@@(\n  width: $(a / b / c);\n)`],
    ["after a property access", `@@(\n  width: $(this.w / 2);\n)`],
  ])("division %s is still division", (_what, block) => {
    expect(value(block)).toBe("width:@0@;");
  });

  test("and a division whose operands hold braces is not a regex either", () => {
    const block = `@@(\n  width: $(({ a: 1 }).a / 2);\n)`;

    expect(value(block)).toBe("width:@0@;");
    expect(expression(block)).toBe("({ a: 1 }).a / 2");
  });

  /**
   * A STRAY slash, which is what a half-written expression looks like — and the shape that made the
   * newline rule visible.
   *
   * `{a + /}` has a `/` where a regex may begin and no closer on that line. The next `/` anywhere is
   * the division two lines below, so without the rule that a regex cannot span lines the scan finds
   * it and the hole swallows its own `}`, the declaration after it, and part of the next hole.
   * Measured, with the guard removed: the hole came back as `{a + /};\n  width: $(b / 2)`.
   *
   * Written as a direct call rather than through a block, because a block wraps this in delimiters
   * that go unbalanced first and return -1 for a different reason — three shapes were tried before
   * this one isolated the rule. An assertion that cannot fail for the reason it exists is not one.
   */
  test("a stray slash does not let a hole run past its own brace", () => {
    const text = `{a + /};\n  width: $(b / 2);`;

    expect(closingHole(text, 0)).toBe("{a + /}".length);
  });

  /** A keyword before the slash opens a regex, which an identifier would not. */
  test("a regex after `return`, inside an arrow body", () => {
    const block = `@@(\n  content: $((() => { return /)/.test(s) ? "a" : "b"; })());\n)`;

    expect(value(block)).toBe("content:@0@;");
  });
});

/**
 * Every refusal is read for its WORDS, not only for having happened.
 *
 * Measured by replacing each message with nonsense: four of them changed nothing in any test, and
 * one of those four was wrong — the unclosed block's said a `@(` needs a `)`, which is not how a
 * block opens. A message no test reads can say anything.
 */
describe("what each refusal says", () => {
  const said = (source: string) => {
    try {
      readBlock(source, source.indexOf("@@(") + 2, "C.tsx");
      return "read";
    } catch (error) {
      return (error as Error).message;
    }
  };

  test.each([
    ["the old brace escape in a value", "@@(\n  color: {tint};\n)", "C.tsx:2:10", "code goes into a block as `$( … )`"],
    ["the old brace escape for a name", "@@(\n  {name}: 24px;\n)", "C.tsx:2:3", "code goes into a block as `$( … )`"],
    ["an escape never closed", "@@(\n  color: $(tint;", "C.tsx:2:10", "this `$(` is never closed — it needs a `)`."],
    [
      "a match never closed",
      "@@(\n  match $(t) {\n    a => ( color: red; );\n",
      "C.tsx:2:3",
      "this match is never closed",
    ],
    ["a block never closed", "@@(\n  color: red;\n", "C.tsx:1:3", "this block is never closed — a `@@(` needs a `)`."],
  ])("%s", (_what, source, where, words) => {
    const message = said(source);

    expect(message).toContain(where);
    expect(message).toContain(words);
  });
});
