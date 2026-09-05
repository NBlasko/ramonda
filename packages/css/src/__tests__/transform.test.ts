import { describe, expect, test } from "vitest";
import { CssBlockError } from "../compiler/errors";
import { transform } from "../compiler/transform";

/**
 * The transform: an author's file in, valid TSX out, plus the blocks it found.
 *
 * This is the piece everything except the framework side and the property types waits on, and it is
 * the one that has to be exactly right about two things nothing downstream can repair — **where each
 * expression's bytes end up**, because that is the source map, and **what it refuses**, because a
 * hole in a position a custom property cannot occupy has no correct compilation.
 */

const emit = (source: string) => transform(source, { filename: "Card.tsx" });

/** The transformed code with the hoisted prologue dropped, which is what the assertions are about. */
function body(source: string): string {
  const result = emit(source);
  if (result === undefined) throw new Error("the transform found no block");
  return result.code.slice(result.code.indexOf("\n\n") + 2);
}

describe("what is not a block", () => {
  test.each([
    ["a file with no block at all", `const a = 1;\n`],
    ["a decorator, which is already valid TypeScript", `class C {\n  @(dec) m() {}\n}\n`],
    ["a decorator factory", `class C {\n  @(makeDec("x")) m() {}\n}\n`],
    ["inside a string", `const s = "css=@@( display: flex; )";\n`],
    ["inside a template", "const s = `css=@@( display: flex; )`;\n"],
    ["inside a line comment", `// css=@@( display: flex; )\nconst a = 1;\n`],
    ["inside a block comment", `/* css=@@( display: flex; ) */\nconst a = 1;\n`],
    ["a regular expression that happens to contain one", `const re = /=@@(x)/;\n`],
  ])("%s", (_what, source) => {
    expect(emit(source)).toBeUndefined();
  });

  /**
   * A member assignment used to be refused, and it was a limitation rather than a rule: the opening
   * had to be preceded by `name =` with whitespace before the name, so `x.css = @@( … )` fell out.
   * A block is an ordinary value now, and assigning one to a property is as reasonable as assigning
   * it to a `const`.
   */
  test("a block assigned to a property is a value like any other", () => {
    const { code } = emit(`const x: { css?: unknown } = {};\nx.css = @@( display: flex; );\n`) ?? { code: "" };

    expect(code).toContain("x.css = _s0;");
  });
});

describe("what a block becomes", () => {
  test("no holes: the descriptor is the value, so the site is not a call", () => {
    const out = body(`const a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(out).toMatch(/const a = <div css=\{_s0\}>x<\/div>;/);
  });

  test("one hole: the expression is transplanted into a call", () => {
    const out = body(`const a = <div css=@@( color: {{this.accent}}; )>x</div>;\n`);

    expect(out).toMatch(/css=\{_s0\(this\.accent\)\}/);
  });

  test("several holes arrive in source order", () => {
    const out = body(`const a = <div css=@@( color: {{a}}; padding: {{b}}px; )>x</div>;\n`);

    expect(out).toMatch(/css=\{_s0\(a, b\)\}/);
  });

  test("the attribute keeps whatever name the author wrote", () => {
    const out = body(`const a = <div sx=@@( display: flex; )>x</div>;\n`);

    expect(out).toMatch(/sx=\{_s0\}/);
  });

  test("the descriptor and its import are hoisted above everything", () => {
    const result = emit(`const a = <div css=@@( color: {{x}}; )>y</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { block as _block } from "@ramonda/css";`);
    expect(result?.code).toContain(`const _s0 = _block("`);
  });

  test("a directive prologue keeps its place at the top of the file", () => {
    // `"use client"` stops being a directive the moment anything precedes it.
    const result = emit(`"use client";\nconst a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`"use client";`);
    expect(result?.code).toContain("_block");
  });

  test("two identical blocks are one class and one descriptor", () => {
    const result = emit(`const a = <div css=@@( display: flex; )>x</div>;\nconst b = <p css=@@(display:flex)>y</p>;\n`);

    expect(result?.blocks).toHaveLength(1);
    expect(result?.code.match(/_block\(/g)).toHaveLength(1);
    expect(result?.code.match(/css=\{_s0\}/g)).toHaveLength(2);
  });

  test("an identifier the file already uses does not get shadowed", () => {
    const result = emit(`const _s0 = 1;\nconst a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(result?.code).not.toMatch(/const _s0 = _block/);
    expect(result?.code).toContain("const _s0 = 1;");
  });
});

describe("the blocks it found", () => {
  test("a class, its rule body, and the properties it declares", () => {
    const result = emit(`const a = <div css=@@( display: flex; border-left: {{accent}}; )>x</div>;\n`);
    const [only] = result?.blocks ?? [];

    expect(only.className).toMatch(/^r-[0-9a-f]{16}$/);
    expect(only.properties).toEqual([`--${only.className}-0`]);
    expect(only.css).toBe(`display:flex;border-left:var(--${only.className}-0);`);
  });

  test("a nested rule keeps its prelude", () => {
    const result = emit(`const a = <div css=@@( color: red; &:hover { color: blue; } )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("color:red;&:hover{color:blue;}");
  });

  test("an at-rule is a nested rule like any other", () => {
    const result = emit(`const a = <div css=@@( @media (min-width: 40rem) { display: grid; } )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("@media (min-width: 40rem){display:grid;}");
  });

  test("a hole inside a nested rule belongs to the block, not to the rule", () => {
    const result = emit(`const a = <div css=@@( &:hover { color: {{hot}}; } )>x</div>;\n`);
    const [only] = result?.blocks ?? [];

    expect(only.css).toBe(`&:hover{color:var(--${only.className}-0);}`);
  });

  test("a comment in the block is not part of it", () => {
    const result = emit(`const a = <div css=@@( /* why */ display: flex; )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("display:flex;");
  });
});

describe("what it refuses, and where", () => {
  /** A custom property holds a value. Everything below is a position one cannot occupy. */
  test.each([
    ["a hole as a property name", `<div css=@@( {{name}}: 24px; )>x</div>`],
    ["a hole in a selector", `<div css=@@( &:{{state}} { color: red; } )>x</div>`],
    ["a hole standing as a whole declaration", `<div css=@@( {{cond ? "display:flex" : ""}} )>x</div>`],
  ])("%s", (_what, source) => {
    expect(() => emit(`const a = ${source};\n`)).toThrow(CssBlockError);
  });

  test("the refusal carries the file and the position of the hole itself", () => {
    const source = `const a = (\n  <div css=@@(\n    {{name}}: 24px;\n  )>x</div>\n);\n`;

    try {
      emit(source);
      expect.unreachable("the transform should have refused");
    } catch (error) {
      const refusal = error as CssBlockError;
      expect(refusal.filename).toBe("Card.tsx");
      expect(refusal.line).toBe(3);
      expect(refusal.message).toContain("Card.tsx:3:");
    }
  });

  test("a block that is never closed is refused rather than eating the file", () => {
    expect(() => emit(`const a = <div css=@@( display: flex;\n`)).toThrow(CssBlockError);
  });

  test("a hole that is never closed is refused too", () => {
    expect(() => emit(`const a = <div css=@@( color: {{accent )>x</div>;\n`)).toThrow(CssBlockError);
  });
});

describe("the prologue's place in the file", () => {
  test("a shebang stays on line one", () => {
    const result = emit(`#!/usr/bin/env node\nconst a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  test("a shebang with nothing after it is still not written over", () => {
    expect(emit(`#!/usr/bin/env node`)).toBeUndefined();
  });

  test("several directives all keep their place", () => {
    const result = emit(`"use client";\n"use strict";\nconst a = <div css=@@( color: red; )>x</div>;\n`);
    const lines = result?.code.split("\n") ?? [];

    expect(lines[0]).toBe(`"use client";`);
    expect(lines[1]).toBe(`"use strict";`);
    expect(lines[2]).toBe(`import { block as _block } from "@ramonda/css";`);
  });

  test("a blank line above a directive does not stop it being one", () => {
    const result = emit(`\n\n"use client";\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[2]).toBe(`"use client";`);
  });

  test("a block comment above a directive does not stop it being one", () => {
    const result = emit(`/* why */\n"use client";\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[1]).toBe(`"use client";`);
  });

  test("a directive may hold an escaped quote, and space before its semicolon", () => {
    const result = emit(`"use \\"x\\"" ;\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`"use \\"x\\"" ;`);
  });

  test("a directive on the same line as real code is not one", () => {
    const result = emit(`"use client"; const a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { block as _block } from "@ramonda/css";`);
  });

  test("a string with no closing quote is not a directive", () => {
    const result = emit(`"use client\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { block as _block } from "@ramonda/css";`);
  });

  test("a CRLF file keeps its directive", () => {
    const result = emit(`"use client";\r\nconst a = <div css=@@( color: red; )>x</div>;\r\n`);

    expect(result?.code.split("\r\n")[0]).toBe(`"use client";`);
  });

  test("a comment above a directive does not stop it being one", () => {
    const result = emit(`// why\n"use client";\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[1]).toBe(`"use client";`);
  });

  test("a string that is not a directive is left where it is", () => {
    const result = emit(`const s = "x";\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { block as _block } from "@ramonda/css";`);
  });

  test("the runtime it imports from can be pointed somewhere else", () => {
    const result = transform(`const a = <div css=@@( color: red; )>x</div>;\n`, { runtime: "my-wrapper" });

    expect(result?.code).toContain(`from "my-wrapper"`);
  });

  test("a file that already names the import binding does not get it taken away", () => {
    const result = emit(`const _block = 1;\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code).toContain("const _block = 1;");
    expect(result?.code).toContain("import { block as __block }");
  });
});

describe("what the block's own text may contain", () => {
  test("a closing paren inside a string does not end the block", () => {
    const result = emit(`const a = <div css=@@( content: ")"; )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe(`content:")";`);
  });

  test("a url() keeps its parens", () => {
    const result = emit(`const a = <div css=@@( background: url(a.png) no-repeat; )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("background:url(a.png) no-repeat;");
  });

  test("an expression may contain braces, strings and parens of its own", () => {
    const out = body(`const a = <div css=@@( color: {{pick({ on: "}}" })}}; )>x</div>;\n`);

    expect(out).toContain(`_s0(pick({ on: "}}" }))`);
  });

  test("an expression may be a template literal, substitutions and all", () => {
    const out = body("const a = <div css=@@( color: {{`rgb(${r}, ${g}, 0)`}}; )>x</div>;\n");

    expect(out).toContain("_s0(`rgb(${r}, ${g}, 0)`)");
  });

  test("a comment inside an expression is the expression's own", () => {
    const out = body(`const a = <div css=@@( color: {{/* why */ accent // and this\n}}; )>x</div>;\n`);

    expect(out).toContain("_s0(/* why */ accent // and this\n)");
  });

  test("an escaped quote inside a CSS string does not end it", () => {
    const result = emit(`const a = <div css=@@( content: "a\\")"; )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe(`content:"a\\")";`);
  });

  test("an empty declaration says nothing, so the block does not carry one", () => {
    const result = emit(`const a = <div css=@@( ;; display: flex;; )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("display:flex;");
  });

  test("a comment between a property and its value is a separator, not nothing", () => {
    const result = emit(`const a = <div css=@@( margin: 1px /* gap */ 2px; )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("margin:1px 2px;");
  });

  test("a comment inside a selector is dropped from the prelude", () => {
    const result = emit(`const a = <div css=@@( &/* why */:hover { color: red; } )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("& :hover{color:red;}");
  });

  test("a nested block is refused rather than silently left behind", () => {
    expect(() => emit(`const a = <div css=@@( color: {{ <b css=@@( color: red; )/> }}; )>x</div>;\n`)).toThrow(
      CssBlockError,
    );
  });

  test("a declaration with no colon at all is refused", () => {
    expect(() => emit(`const a = <div css=@@( display flex; )>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a lone word where a declaration belongs is refused at the block's end too", () => {
    expect(() => emit(`const a = <div css=@@( display )>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a block with neither a semicolon nor a brace before the end is refused", () => {
    expect(() => emit(`const a = <div css=@@( display: flex`)).toThrow(CssBlockError);
  });

  test("a selector may contain a string", () => {
    const result = emit(`const a = <div css=@@( &[data-x="a b"] { color: red; } )>x</div>;\n`);

    expect(result?.blocks[0].css).toBe(`&[data-x="a b"]{color:red;}`);
  });

  test("an escaped quote inside an expression's string does not end it", () => {
    const out = body(`const a = <div css=@@( color: {{pick("a\\"}}b")}}; )>x</div>;\n`);

    expect(out).toContain(`_s0(pick("a\\"}}b"))`);
  });

  test("an unterminated string inside an expression is refused, not run past", () => {
    expect(() => emit(`const a = <div css=@@( color: {{pick("a )>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a template with braces and strings in its substitutions is one expression", () => {
    const out = body("const a = <div css=@@( color: {{`a${ { x: `}}` } }b`}}; )>x</div>;\n");

    expect(out).toContain("_s0(`a${ { x: `}}` } }b`)");
  });

  test("a template that is never closed inside an expression is refused", () => {
    expect(() => emit("const a = <div css=@@( color: {{`a${ b )>x</div>;\n")).toThrow(CssBlockError);
  });
});

/**
 * The two spellings that are a VALUE rather than an attribute.
 *
 * `DESIGN.md` promised the first from the start — "because the compiled form is a value, `@@( … )`
 * outside JSX is the same feature with no special case" — and the code did not do it. Measured, it
 * wrote the attribute form everywhere, so `const panel = @@( … )` became `const panel={_s0}`: an
 * object literal, valid code meaning the wrong thing, with the type error landing wherever the value
 * was eventually used.
 */
describe("a block written as a value", () => {
  test("outside JSX it becomes the value itself, and the name is left alone", () => {
    const code = emit(`const panel = @@( display: flex; );\nexport default panel;\n`)?.code;

    expect(code).toContain("const panel = _s0;");
    expect(code).not.toContain("{_s0}");
  });

  test("inside the braces JSX already has, only the block is replaced", () => {
    const code = emit(`const a = <div id="x" css={@@( display: flex; )}>y</div>;\n`)?.code;

    expect(code).toContain(`<div id="x" css={_s0}>y</div>`);
  });

  test("a hole makes it a call, in both places", () => {
    expect(emit(`const panel = @@( color: {{c}}; );\n`)?.code).toContain("const panel = _s0(c);");
    expect(emit(`const a = <div css={@@( color: {{c}}; )}>y</div>;\n`)?.code).toContain("css={_s0(c)}");
  });

  /** The same CSS is the same class however the site was written — the value has one identity. */
  test("the spelling does not change what is compiled", () => {
    const attribute = emit(`const a = <div css=@@( display: flex; )>y</div>;\n`);
    const value = emit(`const panel = @@( display: flex; );\n`);

    expect(value?.blocks).toEqual(attribute?.blocks);
  });
});
