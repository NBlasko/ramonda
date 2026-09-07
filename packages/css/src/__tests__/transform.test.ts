import { describe, expect, test } from "vitest";
import { CssBlockError } from "../compiler/errors";
import { transform } from "../compiler/transform";
import { namedSites } from "../compiler/references";

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

  test("one hole: the expression stays where it was, inside its declaration's entry", () => {
    const out = body(`const a = <div css=@@( color: {{this.accent}}; )>x</div>;\n`);

    expect(out).toMatch(/css=\{_merge\(\{"color":\["r-[0-9a-zA-Z][^"\s)]*",this\.accent\],\}\)\}/);
  });

  /**
   * The unit is INSIDE the hole, and that is not tidying — `padding: {{b}}px` is the `glued-hole`
   * fault, which the build now refuses. It stood in this fixture until the build began running the
   * checker, which is a small demonstration of what was shipping.
   */
  test("several holes arrive in source order, each with the declaration it belongs to", () => {
    const out = body(`const a = <div css=@@( color: {{a}}; padding: {{b}}; )>x</div>;\n`);

    expect(out).toMatch(/"color":\["r-[0-9a-zA-Z][^"\s)]*",a\],/);
    expect(out).toMatch(/"padding":\["r-[0-9a-zA-Z][^"\s)]*",b\],/);
    expect(out.indexOf('"color"')).toBeLessThan(out.indexOf('"padding"'));
  });

  test("the attribute keeps whatever name the author wrote", () => {
    const out = body(`const a = <div sx=@@( display: flex; )>x</div>;\n`);

    expect(out).toMatch(/sx=\{_s0\}/);
  });

  /**
   * A block with NO holes is hoisted; one with holes is built where it is written, because its
   * values are the render's. **Measured, and it is why this is not simply a call at every site:**
   * 71% of the blocks written to be read in this repository carry no hole, and merging at the site
   * would allocate per element per render for a value that cannot change — 0.86 µs against 0.001 µs
   * for reading a hoisted one.
   */
  test("the import is hoisted above everything, and a block with no holes with it", () => {
    const holed = emit(`const a = <div css=@@( color: {{x}}; )>y</div>;\n`);
    const still = emit(`const a = <div css=@@( color: red; )>y</div>;\n`);

    expect(holed?.code.split("\n")[0]).toBe(`import { merge as _merge } from "@ramonda/css";`);
    expect(holed?.code).not.toContain("const _s0");
    expect(still?.code).toMatch(/const _s0 = _merge\(\{"color":/);
    expect(still?.code).toContain("css={_s0}");
  });

  test("a directive prologue keeps its place at the top of the file", () => {
    // `"use client"` stops being a directive the moment anything precedes it.
    const result = emit(`"use client";\nconst a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`"use client";`);
    expect(result?.code).toContain("_merge");
  });

  test("two identical blocks are one rule and one hoisted value", () => {
    const result = emit(`const a = <div css=@@( display: flex; )>x</div>;\nconst b = <p css=@@(display:flex)>y</p>;\n`);

    expect(result?.blocks).toHaveLength(1);
    expect(result?.code.match(/const _s\d = _merge/g)).toHaveLength(1);
    expect(result?.code.match(/css=\{_s0\}/g)).toHaveLength(2);
  });

  test("an identifier the file already uses does not get shadowed", () => {
    const result = emit(`const _s0 = 1;\nconst a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(result?.code).not.toMatch(/const _s0 = _merge/);
    expect(result?.code).toContain("const _s0 = 1;");
  });
});

describe("the blocks it found", () => {
  /**
   * **One rule per DECLARATION now, not per block**, which is what lets a call site compose two
   * blocks — see `merge`. A rule carries the context it was written in rather than nesting it, so
   * the sheet can write the selector onto its own class and the condition around it.
   */
  test("a class per declaration, its body, and the properties it declares", () => {
    const result = emit(`const a = <div css=@@( display: flex; border-left: {{accent}}; )>x</div>;\n`);
    const [flex, border] = result?.blocks ?? [];

    expect(result?.blocks).toHaveLength(2);
    expect(flex.className).toMatch(/^r-[0-9a-zA-Z][^"\s)]*$/);
    expect(flex.css).toBe("display:flex;");
    expect(flex.properties).toEqual([]);
    expect(border.css).toBe(`border-left:var(--${border.className}-0);`);
    expect(border.properties).toEqual([`--${border.className}-0`]);
  });

  test("a nested rule becomes a selector on its own rule, not a rule inside one", () => {
    const result = emit(`const a = <div css=@@( color: red; &:hover { color: blue; } )>x</div>;\n`);
    const [plain, hovered] = result?.blocks ?? [];

    expect(plain.css).toBe("color:red;");
    expect(plain.selector).toBe("");
    expect(hovered.css).toBe("color:blue;");
    expect(hovered.selector).toBe(":hover");
  });

  test("an at-rule becomes a condition around it", () => {
    const result = emit(`const a = <div css=@@( @media (min-width: 40rem) { display: grid; } )>x</div>;\n`);
    const [only] = result?.blocks ?? [];

    expect(only.css).toBe("display:grid;");
    expect(only.conditions).toEqual(["@media (min-width: 40rem)"]);
  });

  test("a hole inside a nested rule belongs to its own declaration", () => {
    const result = emit(`const a = <div css=@@( &:hover { color: {{hot}}; } )>x</div>;\n`);
    const [only] = result?.blocks ?? [];

    expect(only.css).toBe(`color:var(--${only.className}-0);`);
    expect(only.selector).toBe(":hover");
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
    expect(lines[2]).toBe(`import { merge as _merge } from "@ramonda/css";`);
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

    expect(result?.code.split("\n")[0]).toBe(`import { merge as _merge } from "@ramonda/css";`);
  });

  test("a string with no closing quote is not a directive", () => {
    const result = emit(`"use client\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { merge as _merge } from "@ramonda/css";`);
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

    expect(result?.code.split("\n")[0]).toBe(`import { merge as _merge } from "@ramonda/css";`);
  });

  test("the runtime it imports from can be pointed somewhere else", () => {
    const result = transform(`const a = <div css=@@( color: red; )>x</div>;\n`, { runtime: "my-wrapper" });

    expect(result?.code).toContain(`from "my-wrapper"`);
  });

  test("a file that already names the import binding does not get it taken away", () => {
    const result = emit(`const _merge = 1;\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(result?.code).toContain("const _merge = 1;");
    expect(result?.code).toContain("import { merge as __merge }");
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

    expect(out).toContain(`pick({ on: "}}" })`);
  });

  test("an expression may be a template literal, substitutions and all", () => {
    const out = body("const a = <div css=@@( color: {{`rgb(${r}, ${g}, 0)`}}; )>x</div>;\n");

    expect(out).toContain("`rgb(${r}, ${g}, 0)`");
  });

  test("a comment inside an expression is the expression's own", () => {
    const out = body(`const a = <div css=@@( color: {{/* why */ accent // and this\n}}; )>x</div>;\n`);

    expect(out).toContain("/* why */ accent // and this\n");
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

    // The comment leaves a space behind, because a comment separates tokens — so the selector is a
    // DESCENDANT of the class rather than a pseudo-class on it, which is what the author wrote.
    expect(result?.blocks[0].selector).toBe(" :hover");
    expect(result?.blocks[0].css).toBe("color:red;");
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

  test("a selector may contain a string, spaces and all", () => {
    const result = emit(`const a = <div css=@@( &[data-x="a b"] { color: red; } )>x</div>;\n`);

    expect(result?.blocks[0].selector).toBe(`[data-x="a b"]`);
    expect(result?.blocks[0].css).toBe("color:red;");
  });

  test("an escaped quote inside an expression's string does not end it", () => {
    const out = body(`const a = <div css=@@( color: {{pick("a\\"}}b")}}; )>x</div>;\n`);

    expect(out).toContain(`pick("a\\"}}b")`);
  });

  test("an unterminated string inside an expression is refused, not run past", () => {
    expect(() => emit(`const a = <div css=@@( color: {{pick("a )>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a template with braces and strings in its substitutions is one expression", () => {
    const out = body("const a = <div css=@@( color: {{`a${ { x: `}}` } }b`}}; )>x</div>;\n");

    expect(out).toContain("`a${ { x: `}}` } }b`");
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

  test("a hole builds the map where it was written, in both places", () => {
    expect(emit(`const panel = @@( color: {{c}}; );\n`)?.code).toMatch(
      /const panel = _merge\(\{"color":\["r-[0-9a-zA-Z][^"\s)]*",c\],\}\);/,
    );
    expect(emit(`const a = <div css={@@( color: {{c}}; )}>y</div>;\n`)?.code).toMatch(
      /css=\{_merge\(\{"color":\["r-[0-9a-zA-Z][^"\s)]*",c\],\}\)\}/,
    );
  });

  /** The same CSS is the same class however the site was written — the value has one identity. */
  test("the spelling does not change what is compiled", () => {
    const attribute = emit(`const a = <div css=@@( display: flex; )>y</div>;\n`);
    const value = emit(`const panel = @@( display: flex; );\n`);

    expect(value?.blocks).toEqual(attribute?.blocks);
  });
});

/**
 * A named site — `@@keyframes( … )` — which is not one element's rule.
 *
 * ## What it is for
 *
 * `@keyframes` names something the whole stylesheet uses, so it cannot live inside a block: measured,
 * written there it compiles to `.r-…{@keyframes slide{…}}`, which no browser resolves. Writing it in
 * a stylesheet instead leaves the NAME an unchecked string on both sides — `animation: slidein` is
 * one typo away from silence.
 *
 * A named site closes that: the rule goes to the stylesheet under a generated name, and the site
 * becomes the name as a VALUE. A block reads it through a hole, so a typo is an unresolved
 * identifier and TypeScript reports it with its own *did you mean* — no new checking, and the name
 * stops being a string.
 *
 * Measured in a browser first, because the whole design rests on it: `--n: slide; animation: var(--n)
 * 3s` computes to `animation-name: slide`, identical to writing the name literally.
 */
describe("a keyframes site", () => {
  test("becomes a name, and the rule goes to the sheet", () => {
    const out = emit(`const slide = @@keyframes(\n  from { opacity: 0; }\n  to { opacity: 1; }\n);\n`);

    expect(out?.code).toMatch(/const slide = "r-[0-9a-zA-Z][^"\s)]*";/);
    expect(out?.blocks[0].at).toBe("keyframes");
    expect(out?.blocks[0].css).toContain("from{opacity:0;}");
  });

  test("the same keyframes written twice is one rule", () => {
    const a = emit(`const one = @@keyframes( from { opacity: 0; } );\n`);
    const b = emit(`const two = @@keyframes( from { opacity: 0; } );\n`);

    expect(a?.blocks[0].className).toBe(b?.blocks[0].className);
  });

  test("and it needs no runtime import, because a name is not a value to build", () => {
    const out = emit(`const slide = @@keyframes( from { opacity: 0; } );\n`);

    expect(out?.code).not.toContain("@ramonda/css");
  });

  /**
   * A hole is a custom property ON AN ELEMENT, and a keyframes rule has no element — so a hole in one
   * is refused rather than compiled into something that reads from whatever the animation happens to
   * be applied to.
   */
  test("a hole in one is refused", () => {
    expect(() => emit(`const slide = @@keyframes( from { opacity: {{n}}; } );\n`)).toThrow(/hole/);
  });

  test("an at-rule this package does not know is refused", () => {
    expect(() => emit(`const x = @@nonsense( color: red; );\n`)).toThrow(/nonsense/);
  });
});

/**
 * A reference to a named site, resolved where it is known: at BUILD time.
 *
 * A hole is a custom property on an element, and for a value the runtime computes that is exactly
 * right. A named site is not that — it is a constant this compiler produced itself, three lines up
 * — and treating a reference to one as a runtime hole is wrong in two ways, one slow and one fatal:
 *
 * - `animation: {{slide}} 3s` becomes `animation: var(--r-…-0) 3s` and a value set per element, for
 *   a string that was decided at build time;
 * - `var({{angle}})` becomes `var(var(--r-…-0))`, and **`var()` takes a literal name**, not another
 *   `var()`. Measured in Chromium: nothing resolves, and the declaration is dropped.
 *
 * So a hole whose expression is exactly the binding of a named site in the same file is not a hole
 * at all. It is that name, written in.
 */
describe("a reference to a named site", () => {
  test("is written in, and costs no custom property", () => {
    const out = emit(
      `const slide = @@keyframes( from { opacity: 0; } );\nconst card = @@( animation: {{slide}} 3s; );\n`,
    );

    const [frames, card] = out?.blocks ?? [];
    expect(card.css).toBe(`animation:${frames.className} 3s;`);
    expect(card.properties).toEqual([]);
    expect(out?.code).not.toContain("var(--");
  });

  test("a registered property is named as a custom property, because that is what it names", () => {
    const out = emit(`const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n`);

    expect(out?.code).toMatch(/const angle = "--r-[0-9a-zA-Z][^"\s)]*";/);
    expect(out?.blocks[0].className).toMatch(/^--r-/);
  });

  test("and one can be READ by a block, which is what `var()` needs a literal for", () => {
    const out = emit(
      `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
        `const card = @@( transform: rotate(var({{angle}})); );\n`,
    );

    const [property, card] = out?.blocks ?? [];
    expect(card.css).toBe(`transform:rotate(var(${property.className}));`);
    expect(card.properties).toEqual([]);
  });

  test("and SET by one, which is the only way a registered property is worth registering", () => {
    const out = emit(
      `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
        `const card = @@( {{angle}}: 45deg; );\n`,
    );

    const [property, card] = out?.blocks ?? [];
    expect(card.css).toBe(`${property.className}:45deg;`);
  });

  test("two blocks referring to the same name are still one rule each", () => {
    const out = emit(
      `const slide = @@keyframes( from { opacity: 0; } );\n` +
        `const a = @@( animation: {{slide}} 3s; );\n` +
        `const b = @@( animation: {{slide}} 3s; );\n`,
    );

    expect(out?.blocks).toHaveLength(2);
  });

  test("but blocks referring to DIFFERENT names are different rules", () => {
    const out = emit(
      `const one = @@keyframes( from { opacity: 0; } );\n` +
        `const two = @@keyframes( to { opacity: 1; } );\n` +
        `const a = @@( animation: {{one}} 3s; );\n` +
        `const b = @@( animation: {{two}} 3s; );\n`,
    );

    const [, , a, b] = out?.blocks ?? [];
    expect(a.className).not.toBe(b.className);
  });

  /** Anything else in a hole is a runtime value, and nothing about this changes that. */
  test("an expression that is not one of them is still a hole", () => {
    const out = emit(`const card = @@( animation: {{name}} 3s; );\n`);

    expect(out?.blocks[0].properties).toHaveLength(1);
    expect(out?.blocks[0].css).toContain("var(--");
  });

  /** A hole in a property name stays a refusal for everything that is not a registered property. */
  test("a hole that resolves to nothing cannot stand in a property name", () => {
    expect(() => emit(`const card = @@( {{whatever}}: 45deg; );\n`)).toThrow(/@@property/);
  });
});

/**
 * A named site is a VALUE, so it cannot be a JSX attribute.
 *
 * `css=@@( … )` is rewritten from the attribute's NAME, because the braces are ours to add. A named
 * site compiles to a string instead, and the same rewrite put that string where the attribute name
 * was: measured, `<div css=@@keyframes( … )>` came out as `<div "r-…">x</div>` — a syntax error the
 * build emitted without a word.
 */
describe("a named site in attribute position", () => {
  test("is refused rather than emitted as broken JSX", () => {
    expect(() => emit(`const a = <div css=@@keyframes( from { opacity: 0; } )>x</div>;\n`)).toThrow(/attribute/);
  });

  test("and the refusal says where it does belong", () => {
    expect(() => emit(`const a = <div css=@@font-face( src: url("/b.woff2"); )>x</div>;\n`)).toThrow(/const/);
  });
});

/**
 * The map and the rule agree on the name — which is not free, because they are read differently.
 *
 * `namedSites` reads TOLERANTLY: it runs in an editor as well as in a build, and a name is still a
 * name while the block under it is half-typed. The transform reads STRICTLY. If those two ever
 * disagreed about a block the build ACCEPTED, a reference would compile to a name no rule has — an
 * animation that silently does not run, with nothing to blame.
 *
 * Measured on the three shapes where the reads do diverge — an unclosed frame, a declaration with no
 * colon, a stray brace — the strict read REFUSES all three, so nothing ships. This asserts the other
 * half: where the build accepts, the two names are the same one.
 */
describe("the reference map and the emitted rule", () => {
  test.each([
    ["frames", `const x = @@keyframes( from { opacity: 0; } to { opacity: 1; } );\n`],
    ["a face", `const x = @@font-face( font-family: "B"; src: url("/b.woff2"); );\n`],
    ["a property", `const x = @@property( syntax: "*"; inherits: false; );\n`],
    ["a frame with a comment in it", `const x = @@keyframes( from { /* start */ opacity: 0; } );\n`],
    ["nested rules and odd spacing", `const x = @@keyframes(\n\n  from   {\n opacity:0;\n  }\n\n);\n`],
  ])("agree for %s", (_what, source) => {
    const out = emit(source);

    expect(namedSites(source).get("x")).toBe(out?.blocks[0].className);
  });
});

/**
 * Two declarations with the same TEXT in different contexts are two rules, not one.
 *
 * A class name is the hash of what makes a rule that rule, and the text alone does not: `color: red`
 * and `&:hover { color: red }` say the same thing about two different states. **Measured before this
 * was fixed — they hashed the same, the sheet kept whichever arrived first, and the hover rule was
 * emitted as `.r-…{color:red}` with no selector.** It applied always.
 *
 * The failure is the one this whole package is written around: silent, and against a page nobody
 * edited — across files it is worse still, since the two blocks need not know about each other, and
 * the sheet's collision assertion could not see it either, because the css TEXT was identical.
 */
describe("the same declaration in two contexts", () => {
  test("a selector makes it a different rule", () => {
    const out = emit(`const c = @@( color: red; &:hover { color: red; } );\n`);

    expect(out?.blocks).toHaveLength(2);
    expect(out?.blocks[0].className).not.toBe(out?.blocks[1].className);
    expect(out?.blocks.map((one) => one.selector).sort()).toEqual(["", ":hover"]);
  });

  test("a condition does too", () => {
    const out = emit(`const c = @@( padding: 8px; @media (min-width: 40rem) { padding: 8px; } );\n`);

    expect(out?.blocks).toHaveLength(2);
    expect(out?.blocks[0].className).not.toBe(out?.blocks[1].className);
  });

  test("and two different conditions are two rules again", () => {
    const out = emit(`const c = @@( @media (min-width: 40rem) { padding: 8px; } @media print { padding: 8px; } );\n`);

    expect(out?.blocks).toHaveLength(2);
  });

  /** Dedupe is still dedupe: the same declaration in the same context is one rule, as it must be. */
  test("but the same declaration in the same context is still one rule", () => {
    const a = emit(`const c = @@( &:hover { color: red; } );\n`);
    const b = emit(`const d = @@( &:hover { color: red; } );\n`);

    expect(a?.blocks).toHaveLength(1);
    expect(a?.blocks[0].className).toBe(b?.blocks[0].className);
  });

  test("and a nested rule's own declarations still dedupe against another file's", () => {
    const a = emit(`const c = @@( @media print { color: red; } );\n`);
    const b = emit(`const d = @@( @media print { color: red; } );\n`);

    expect(a?.blocks[0].className).toBe(b?.blocks[0].className);
  });
});

/**
 * The build refuses what the checker finds, and it did NOT until this was written.
 *
 * **Measured, and it is the fault behind the `@property` report.** `checkBlock` reports
 * `at-rule-out-of-place` for a `@property` written inside a block, with a message that says exactly
 * what to do — and the transform compiled it anyway, as a CONDITION. What shipped out of a real
 * build was `@property --x { .r-hash { syntax: "<color>" } }`: a `@property` wrapping a style rule,
 * which Chromium 151 drops entirely, leaving the name accepting any junk at all. Every other fault
 * the checker knows about shipped the same way.
 *
 * The reason is one seam: `checkBlock` was called by `ramonda-check` and by the editor, and
 * `transform` — the only path a BUILD takes — called neither. So the two people most likely to see a
 * fault were told, and the artefact was not.
 *
 * It goes in `transform` rather than in each bundler's plugin because there are two of those today
 * and the next one would forget. `transform` has exactly two callers, `vite.ts` and `esbuild.ts`,
 * and both of them must refuse.
 */
describe("the build refuses what the checker finds", () => {
  test("a `@property` inside a block, which used to ship as invalid CSS", () => {
    expect(() => emit(`const s = @@(\n  @property --x { syntax: "<color>"; }\n  color: red;\n);\n`)).toThrow(
      CssBlockError,
    );
  });

  test("and the refusal carries the checker's own words, not a second opinion", () => {
    try {
      emit(`const s = @@(\n  @property --x { syntax: "<color>"; }\n);\n`);
      throw new Error("the transform did not refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(CssBlockError);
      expect((error as CssBlockError).message).toContain("names something the whole stylesheet uses");
    }
  });

  /** `//` is not a CSS comment. Shipped, it takes the whole stylesheet down somewhere else entirely. */
  test("a `//` comment, which a real CSS compiler refuses by failing the FILE", () => {
    expect(() => emit(`const s = @@(\n  // why\n  color: red;\n);\n`)).toThrow(CssBlockError);
  });

  /**
   * A DASHED property name near a real one. A bare name is deliberately not this rule's — the types
   * report it with TypeScript's own *did you mean*, and a dashed name cannot be an unquoted object
   * key, so this is the hole the types leave. Measured while writing these: `colour: red` is
   * reported by nothing the transform runs, which is correct and is why the example is dashed.
   */
  test("a dashed property name that is nearly a real one", () => {
    expect(() => emit(`const s = @@( padding-lft: 8px; );\n`)).toThrow(CssBlockError);
  });

  /** And a block with nothing wrong still compiles, which is the half that must not regress. */
  test("a sound block is untouched", () => {
    expect(body(`const s = @@( display: flex; gap: 8px; );\n`)).toContain("const s = _s0;");
  });
});
