import { describe, expect, test } from "vitest";
import { CssBlockError } from "../compiler/errors";
import { checkSource } from "../compiler/source";
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
    ["inside a string", `const s = "css={@@( display: flex; )}";\n`],
    ["inside a template", "const s = `css={@@( display: flex; )}`;\n"],
    ["inside a line comment", `// css={@@( display: flex; )}\nconst a = 1;\n`],
    ["inside a block comment", `/* css={@@( display: flex; )} */\nconst a = 1;\n`],
    ["a regular expression that happens to contain one", `const re = /={@@(x)}/;\n`],
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
    const out = body(`const a = <div className={@@( display: flex; )}>x</div>;\n`);

    expect(out).toMatch(/const a = <div className=\{_s0\}>x<\/div>;/);
  });

  /**
   * A RUNTIME VALUE never gets this far. The build runs the same rules the check does, so
   * `color: $(this.accent)` is refused here rather than compiled into a custom property — which is
   * what these two tests used to measure, and what `hole-not-allowed` replaced.
   */
  test("a runtime value in a declaration is refused by the build, not compiled", () => {
    expect(() => emit(`const a = <div className={@@( color: $(this.accent); )}>x</div>;\n`)).toThrow(/match/);
  });

  test("the attribute keeps whatever name the author wrote", () => {
    const out = body(`const a = <div sx={@@( display: flex; )}>x</div>;\n`);

    expect(out).toMatch(/sx=\{_s0\}/);
  });

  /**
   * **EVERY block is hoisted now**, because no block carries a value the render decides.
   *
   * There used to be two paths: a block with no hole was hoisted to module scope, and one with a
   * hole was built at the site, because its values were the render's. The second is gone with the
   * hole — measured here, and it is the whole return on refusing it: merging at a site allocates
   * per element per render, 0.86 µs against 0.001 µs for reading a hoisted one.
   */
  test("the import is hoisted above everything, and every block with it", () => {
    const out = emit(`const a = <div className={@@( color: red; )}>y</div>;\n`);

    expect(out?.code.split("\n")[0]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
    expect(out?.code).toMatch(/const _s0 = _merge\("r-c-red"\);/);
    expect(out?.code).toContain("className={_s0}");
  });

  test("a directive prologue keeps its place at the top of the file", () => {
    // `"use client"` stops being a directive the moment anything precedes it.
    const result = emit(`"use client";\nconst a = <div className={@@( display: flex; )}>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`"use client";`);
    expect(result?.code).toContain("_merge");
  });

  test("two identical blocks are one rule and one hoisted value", () => {
    const result = emit(
      `const a = <div className={@@( display: flex; )}>x</div>;\nconst b = <p className={@@(display:flex;)}>y</p>;\n`,
    );

    expect(result?.blocks).toHaveLength(1);
    expect(result?.code.match(/const _s\d = _merge/g)).toHaveLength(1);
    expect(result?.code.match(/className=\{_s0\}/g)).toHaveLength(2);
  });

  test("an identifier the file already uses does not get shadowed", () => {
    const result = emit(`const _s0 = 1;\nconst a = <div className={@@( display: flex; )}>x</div>;\n`);

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
    const result = emit(`const a = <div className={@@( display: flex; border-left: 4px solid red; )}>x</div>;\n`);
    const [flex, ...border] = result?.blocks ?? [];

    // Four, because a shorthand reaches the sheet as the longhands it sets — see `splitOf`.
    expect(result?.blocks).toHaveLength(4);
    expect(flex.className).toMatch(/^r-[0-9a-zA-Z][^"\s)]*$/);
    expect(flex.css).toBe("display:flex;");
    // Nothing declares a custom property of its own any more: a block carries no runtime value, so
    // the only names on an element are the ones a `@@property` site registered.
    expect(flex.properties).toEqual([]);
    expect(border.map((one) => one.css)).toEqual([
      "border-left-color:red;",
      "border-left-style:solid;",
      "border-left-width:4px;",
    ]);
    expect(border.every((one) => one.properties.length === 0)).toBe(true);
  });

  test("a nested rule becomes a selector on its own rule, not a rule inside one", () => {
    const result = emit(`const a = <div className={@@( color: red; &:hover { color: blue; } )}>x</div>;\n`);
    const [plain, hovered] = result?.blocks ?? [];

    expect(plain.css).toBe("color:red;");
    expect(plain.selector).toBe("");
    expect(hovered.css).toBe("color:blue;");
    expect(hovered.selector).toBe("&:hover");
  });

  test("an at-rule becomes a condition around it", () => {
    const result = emit(`const a = <div className={@@( @media (min-width: 40rem) { display: grid; } )}>x</div>;\n`);
    const [only] = result?.blocks ?? [];

    expect(only.css).toBe("display:grid;");
    expect(only.conditions).toEqual(["@media (min-width: 40rem)"]);
  });

  test("a comment in the block is not part of it", () => {
    const result = emit(`const a = <div className={@@( /* why */ display: flex; )}>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("display:flex;");
  });
});

describe("what it refuses, and where", () => {
  /** A custom property holds a value. Everything below is a position one cannot occupy. */
  test.each([
    ["a hole as a property name", `<div className={@@( $(name): 24px; )}>x</div>`],
    ["a hole in a selector", `<div className={@@( &:$(state) { color: red; } )}>x</div>`],
    ["a hole standing as a whole declaration", `<div className={@@( $(cond ? "display:flex" : "") )}>x</div>`],
  ])("%s", (_what, source) => {
    expect(() => emit(`const a = ${source};\n`)).toThrow(CssBlockError);
  });

  test("the refusal carries the file and the position of the hole itself", () => {
    const source = `const a = (\n  <div className={@@(\n    $(name): 24px;\n  )}>x</div>\n);\n`;

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

  /**
   * **A bare JSX attribute, which this stopped compiling.**
   *
   * `css={@@( … )}` and `const panel = @@( … )` are expressions; `css=@@( … )` is a shape only JSX
   * has, and compiling it meant this package extended JSX rather than TypeScript. The refusal is in
   * the BUILD and not only in the editor, because a spelling that is not compiled has to stop the
   * thing that would otherwise compile it.
   *
   * The rule ran for a while as `uncolourable-block`, a suggestion the editor drew and the build
   * ignored — right while the spelling worked, and wrong the moment it did not.
   */
  test.each([
    ["the first attribute, which used to be the one that worked", `<div css=@@( display: flex; )>x</div>`],
    ["after another attribute", `<div className="lead" css=@@( display: flex; )>x</div>`],
    ["under a name that is not `css`", `<div sx=@@( display: flex; )>x</div>`],
  ])("a block written as a bare attribute: %s", (_what, source) => {
    expect(() => emit(`const a = ${source};\n`)).toThrow(CssBlockError);
  });

  test("and the refusal names the rule and the spelling to write", () => {
    try {
      emit(`const a = <div css=@@( display: flex; )>x</div>;\n`);
      expect.unreachable("the transform should have refused");
    } catch (error) {
      const refusal = error as CssBlockError;
      expect(refusal.message).toContain("block-as-a-jsx-attribute");
      expect(refusal.message).toContain("css={@@( … )}");
      expect(refusal.message).toContain("TypeScript value");
    }
  });

  /** The braced spellings are what it is pointing at, so they had better not be refused. */
  test.each([
    ["a braced attribute", `const a = <div className={@@( display: flex; )}>x</div>;\n`],
    ["a braced attribute after another", `const a = <div id="p" className={@@( display: flex; )}>x</div>;\n`],
    ["a value outside JSX", `const panel = @@( display: flex; );\nexport default panel;\n`],
  ])("%s compiles", (_what, source) => {
    expect(() => emit(source)).not.toThrow();
  });

  test("a block that is never closed is refused rather than eating the file", () => {
    expect(() => emit(`const a = <div className={@@( display: flex;\n`)).toThrow(CssBlockError);
  });

  test("a hole that is never closed is refused too", () => {
    expect(() => emit(`const a = <div className={@@( color: {{accent )}>x</div>;\n`)).toThrow(CssBlockError);
  });

  /**
   * A NAMED site's refusal names the same file as any other, and it used to name NONE.
   *
   * A named site is read three times: once to learn what it is called, once for the `syntax` it
   * declares, and once properly. The first two only want a name, so they read tolerantly and passed
   * `""` for the file — and a NUL is refused in both modes on purpose, because it is what marks a
   * hole in the compiler's own text. So it escaped from a read whose job was to report nothing, and
   * the build said `:1:36  a NUL character cannot be written…` about no file at all, ahead of the
   * read that would have named the right one.
   */
  test("a NUL in a named site is refused against this file, not against none", () => {
    const source = `const brand = @@property(\n  syntax: "\u0000";\n);\nconst a = @@( color: $(brand); );\n`;

    try {
      emit(source);
      expect.unreachable("the transform should have refused");
    } catch (error) {
      const refusal = error as CssBlockError;
      expect(refusal.filename).toBe("Card.tsx");
      expect(refusal.line).toBe(2);
      expect(refusal.message).toContain("Card.tsx:2:");
    }
  });

  /**
   * And a fault in a module this file only IMPORTS from is that module's own compile to report.
   *
   * The rule of an imported named site is carried across — the reader emits it, or the bundler drops
   * the module and the registration never ships. That read passed the IMPORTING file's name with an
   * offset into the imported text, which is a position in a file that has no such content.
   */
  test("a NUL in an imported module is left to that module's own compile", () => {
    // No reference to it: the imported module is READ whatever this file does with it, which is
    // what carries an imported site's rule across — and what made an offset into it land here.
    const source = `import { brand } from "./theme";\nconst a = @@( color: red; );\n`;
    let reads = 0;
    const read = () => {
      reads++;
      return `export const brand = @@property( syntax: "\u0000"; );\n`;
    };

    expect(() => transform(source, { filename: "Card.tsx", read })).not.toThrow();
    // Or the silence would be the module never being read, which is not the thing under test.
    expect(reads).toBeGreaterThan(0);
  });
});

/**
 * **The same source compiles to the same bytes**, which is the claim caching rests on.
 *
 * A class name is a hash, the registrations are objects, and both are built by walking collections.
 * If any of that depended on insertion order across FILES — a module-level map, a counter, a cache
 * keyed on what was seen first — two builds of one repository would emit different names, and
 * nothing would fail. The stylesheet would simply be a different file every time: a cold cache on
 * every deploy, a `dist` diff full of noise, and no error anywhere.
 *
 * Measured across separate processes and hash seeds while this was written, all identical. What is
 * asserted here is the half a test can hold: the same source twice, and the same source after a
 * DIFFERENT one has been through the compiler, which is what a module-level cache would break.
 */
describe("what a second build gets", () => {
  const SOURCE =
    `declare const t: "a" | "b";\n` +
    `const card = @@(\n  padding: 8px;\n  cursor: match $(t) { a => pointer; b => default; };\n` +
    `  @media (min-width: 40rem) { color: red; }\n  &[data-on] { gap: 2px; }\n);\n` +
    `const a = <div className={card}>x</div>;\n`;

  test("the same source twice is the same bytes", () => {
    expect(emit(SOURCE)?.code).toBe(emit(SOURCE)?.code);
  });

  test("and is not changed by what went through before it", () => {
    const alone = emit(SOURCE)?.code;
    emit(`const other = <div className={@@( color: blue; margin: 1px; )}>y</div>;\n`);
    emit(`const third = <p className={@@( @media print { gap: 9px; } )}>z</p>;\n`);

    expect(emit(SOURCE)?.code).toBe(alone);
  });

  /** The classes in particular, since they are what the markup and the stylesheet must agree on. */
  test("and the classes it names are the same both times", () => {
    const classes = (code: string | undefined) => /_merge\("([^"]*)"\)/.exec(code ?? "")?.[1];

    expect(classes(emit(SOURCE)?.code)).toBe(classes(emit(SOURCE)?.code));
  });
});

describe("the prologue's place in the file", () => {
  /**
   * **The COMBINATIONS, which each of the cases below tests one half of.**
   *
   * Each head has a rule of its own — a shebang owns line one, a directive stops being one the
   * moment anything precedes it, a leading comment is where TypeScript reads `@jsxImportSource` and
   * `@ts-nocheck` from — and the prologue has to satisfy all of them at once. Measured across every
   * combination rather than one at a time, because a rule that holds alone is not a rule that holds
   * beside another, and this is the file where a prologue lands between them.
   */
  test.each([
    ["a shebang and a directive", '#!/usr/bin/env node\n"use client";\n'],
    ["a shebang and a licence", "#!/usr/bin/env node\n/* @license MIT */\n"],
    ["a directive then a licence", '"use client";\n/* @license MIT */\n'],
    ["a licence then a directive", '/* @license MIT */\n"use client";\n'],
    ["all three", '#!/usr/bin/env node\n/* @license MIT */\n"use client";\n'],
    ["two comments and a directive", '/* a */\n// b\n"use client";\n'],
  ])("%s keep what each of them owns", (_what, head) => {
    const lines = (emit(`${head}const a = <div className={@@( color: red; )}>x</div>;\n`)?.code ?? "").split("\n");

    if (head.startsWith("#!")) expect(lines[0]).toBe("#!/usr/bin/env node");
    if (head.includes('"use client"')) {
      const at = lines.findIndex((line) => line.trim() === `"use client";`);
      const above = lines.slice(0, at).filter((line) => line.trim() !== "");
      // A shebang and comments may precede a directive. An `import` may not — that is the fault.
      expect(above.filter((line) => !line.startsWith("#!") && !/^\s*(\/\/|\/\*|\*)/.test(line))).toEqual([]);
    }
  });

  /**
   * **The pragma a leading comment can carry, which is why the prologue goes BELOW the trivia.**
   *
   * `@jsxImportSource` names a per-file JSX runtime and `tsc` reads it from the FIRST comment.
   * Measured when this was written: an import prepended above it made `tsc` fall back to
   * `react/jsx-runtime`, silently. This asserts the order that keeps it working.
   */
  test("a `@jsxImportSource` pragma stays above the import", () => {
    const lines = (
      emit(`/** @jsxImportSource preact */\nconst a = <div className={@@( color: red; )}>x</div>;\n`)?.code ?? ""
    ).split("\n");

    expect(lines.findIndex((line) => line.includes("jsxImportSource"))).toBeLessThan(
      lines.findIndex((line) => line.startsWith("import {")),
    );
  });

  test("a shebang stays on line one", () => {
    const result = emit(`#!/usr/bin/env node\nconst a = <div className={@@( display: flex; )}>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  test("a shebang with nothing after it is still not written over", () => {
    expect(emit(`#!/usr/bin/env node`)).toBeUndefined();
  });

  test("several directives all keep their place", () => {
    const result = emit(`"use client";\n"use strict";\nconst a = <div className={@@( color: red; )}>x</div>;\n`);
    const lines = result?.code.split("\n") ?? [];

    expect(lines[0]).toBe(`"use client";`);
    expect(lines[1]).toBe(`"use strict";`);
    expect(lines[2]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
  });

  test("a blank line above a directive does not stop it being one", () => {
    const result = emit(`\n\n"use client";\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[2]).toBe(`"use client";`);
  });

  test("a block comment above a directive does not stop it being one", () => {
    const result = emit(`/* why */\n"use client";\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[1]).toBe(`"use client";`);
  });

  test("a directive may hold an escaped quote, and space before its semicolon", () => {
    const result = emit(`"use \\"x\\"" ;\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`"use \\"x\\"" ;`);
  });

  test("a directive on the same line as real code is not one", () => {
    const result = emit(`"use client"; const a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
  });

  test("a string with no closing quote is not a directive", () => {
    const result = emit(`"use client\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
  });

  test("a CRLF file keeps its directive", () => {
    const result = emit(`"use client";\r\nconst a = <div className={@@( color: red; )}>x</div>;\r\n`);

    expect(result?.code.split("\r\n")[0]).toBe(`"use client";`);
  });

  /**
   * A LEADING COMMENT stays leading, because TypeScript reads pragmas out of exactly those.
   *
   * `@jsxImportSource` in a file comment is how a per-file JSX runtime is named, and this option's
   * whole purpose is another JSX library — so the two meet. Measured on both transformers a build
   * can use: with the import prepended above the comment, esbuild still honours the pragma and
   * **`tsc` falls back to `react/jsx-runtime`**, silently, which is the wrong runtime for the file.
   * `@ts-nocheck`, `@ts-check` and `/// <reference … />` are read from the same place and would go
   * the same way.
   */
  test.each([
    ["a JSX pragma", `/** @jsxImportSource preact */`],
    ["a ts directive", `// @ts-nocheck`],
    ["a reference", `/// <reference types="x" />`],
    ["a licence header", `/* Copyright someone */`],
  ])("the prologue goes below a leading comment, not above it: %s", (_what, comment) => {
    const result = emit(`${comment}
const a = <div className={@@( color: red; )}>x</div>;
`);
    const lines = result?.code.split("\n") ?? [];

    expect(lines[0]).toBe(comment);
    expect(lines[1]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
  });

  test("and below one that follows a directive, which is where both rules meet", () => {
    const result = emit(
      `"use client";
/** @jsxImportSource preact */
const a = <div className={@@( color: red; )}>x</div>;
`,
    );
    const lines = result?.code.split("\n") ?? [];

    expect(lines[0]).toBe(`"use client";`);
    expect(lines[1]).toBe(`/** @jsxImportSource preact */`);
    expect(lines[2]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
  });

  test("a comment above a directive does not stop it being one", () => {
    const result = emit(`// why\n"use client";\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[1]).toBe(`"use client";`);
  });

  test("a string that is not a directive is left where it is", () => {
    const result = emit(`const s = "x";\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code.split("\n")[0]).toBe(`import { mergeClassNames as _merge } from "@ramonda/css";`);
  });

  test("the runtime it imports from can be pointed somewhere else", () => {
    const result = transform(`const a = <div className={@@( color: red; )}>x</div>;\n`, { runtime: "my-wrapper" });

    expect(result?.code).toContain(`from "my-wrapper"`);
  });

  /**
   * **A PATH, and it was written into the import unescaped.** The option's whole purpose is a wrapper
   * for another JSX library, which points it at a module — and the bundler plugins point it at an
   * absolute one, which on Windows is `C:\Users\…`. Measured through esbuild: that emitted
   * `from "C:\Users\x\dist\index.js"`, which is a *syntax error* — `\x` starts a hex escape and
   * `\d` is not a hex digit — so the build failed on a line no author wrote. A path with a quote in
   * it ended the string early, the same way.
   *
   * The CSS import two functions away has always been `JSON.stringify`ed. One of the two was right.
   */
  test.each([
    ["a Windows path", "C:\\Users\\x\\dist\\index.js"],
    ["a quote", 'a"b'],
    ["a newline", "a\nb"],
  ])("and the module it names is escaped, not interpolated: %s", (_what, runtime) => {
    const result = transform(`const a = <div className={@@( color: red; )}>x</div>;\n`, { runtime });

    expect(result?.code.split("\n")[0]).toBe(`import { mergeClassNames as _merge } from ${JSON.stringify(runtime)};`);
    // And it parses, which is the thing the unescaped version did not do.
    expect(() => new Function(`return ${JSON.stringify(runtime)}`)()).not.toThrow();
  });

  test("a file that already names the import binding does not get it taken away", () => {
    const result = emit(`const _merge = 1;\nconst a = <div className={@@( color: red; )}>x</div>;\n`);

    expect(result?.code).toContain("const _merge = 1;");
    expect(result?.code).toContain("import { mergeClassNames as __merge }");
  });
});

describe("what the block's own text may contain", () => {
  test("a closing paren inside a string does not end the block", () => {
    const result = emit(`const a = <div className={@@( content: ")"; )}>x</div>;\n`);

    expect(result?.blocks[0].css).toBe(`content:")";`);
  });

  test("a url() keeps its parens", () => {
    const result = emit(`const a = <div className={@@( background-image: url(a.png); )}>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("background-image:url(a.png);");
  });

  /**
   * Every one of these is about the READER carrying an expression through verbatim, and the vehicle
   * is a CONDITION. It used to be a hole in a value; a runtime value in a declaration is refused
   * now, and a condition is the brace that still holds any expression an author can write.
   */
  test("an expression may contain braces, strings and parens of its own", () => {
    const out = body(`const a = <div className={@@( when $(pick({ on: "}}" })) { color: red; } )}>x</div>;\n`);

    expect(out).toContain(`pick({ on: "}}" })`);
  });

  test("an expression may be a template literal, substitutions and all", () => {
    const out = body("const a = <div className={@@( when $(`rgb(${r}, ${g}, 0)`) { color: red; } )}>x</div>;\n");

    expect(out).toContain("`rgb(${r}, ${g}, 0)`");
  });

  test("a comment inside an expression is the expression's own", () => {
    const out = body(
      `const a = <div className={@@( when $(/* why */ accent // and this\n) { color: red; } )}>x</div>;\n`,
    );

    expect(out).toContain("/* why */ accent // and this\n");
  });

  test("an escaped quote inside a CSS string does not end it", () => {
    const result = emit(`const a = <div className={@@( content: "a\\")"; )}>x</div>;\n`);

    expect(result?.blocks[0].css).toBe(`content:"a\\")";`);
  });

  test("an empty declaration says nothing, so the block does not carry one", () => {
    const result = emit(`const a = <div className={@@( ;; display: flex;; )}>x</div>;\n`);

    expect(result?.blocks[0].css).toBe("display:flex;");
  });

  test("a comment between a property and its value is a separator, not nothing", () => {
    const result = emit(`const a = <div className={@@( margin: 1px /* gap */ 2px; )}>x</div>;\n`);

    // Two values, not one: the split puts the first on the block axis and the second on the inline
    // one, which is the separation this is about, made visible.
    expect(result?.blocks.map((one) => one.css)).toEqual([
      "margin-top:1px;",
      "margin-right:2px;",
      "margin-bottom:1px;",
      "margin-left:2px;",
    ]);
  });

  test("a comment inside a selector is dropped from the prelude", () => {
    const result = emit(`const a = <div className={@@( &/* why */:hover { color: red; } )}>x</div>;\n`);

    // The comment leaves a space behind, because a comment separates tokens — so the selector is a
    // DESCENDANT of the class rather than a pseudo-class on it, which is what the author wrote.
    expect(result?.blocks[0].selector).toBe("& :hover");
    expect(result?.blocks[0].css).toBe("color:red;");
  });

  test("a nested block is refused rather than silently left behind", () => {
    expect(() =>
      emit(`const a = <div className={@@( color: $( <b className={@@( color: red; )}/> ); )}>x</div>;\n`),
    ).toThrow(CssBlockError);
  });

  test("a declaration with no colon at all is refused", () => {
    expect(() => emit(`const a = <div className={@@( display flex; )}>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a lone word where a declaration belongs is refused at the block's end too", () => {
    expect(() => emit(`const a = <div className={@@( display )}>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a block with neither a semicolon nor a brace before the end is refused", () => {
    expect(() => emit(`const a = <div className={@@( display: flex`)).toThrow(CssBlockError);
  });

  test("a selector may contain a string, spaces and all", () => {
    const result = emit(`const a = <div className={@@( &[data-x="a b"] { color: red; } )}>x</div>;\n`);

    expect(result?.blocks[0].selector).toBe(`&[data-x="a b"]`);
    expect(result?.blocks[0].css).toBe("color:red;");
  });

  test("an escaped quote inside an expression's string does not end it", () => {
    const out = body(`const a = <div className={@@( when $(pick("a\\")b")) { color: red; } )}>x</div>;\n`);

    expect(out).toContain(`pick("a\\")b")`);
  });

  test("an unterminated string inside an expression is refused, not run past", () => {
    expect(() => emit(`const a = <div className={@@( color: {{pick("a )>x</div>;\n`)).toThrow(CssBlockError);
  });

  test("a template with braces and strings in its substitutions is one expression", () => {
    const out = body("const a = <div className={@@( when $(`a${ { x: `}` } }b`) { color: red; } )}>x</div>;\n");

    expect(out).toContain("`a${ { x: `}` } }b`");
  });

  test("a template that is never closed inside an expression is refused", () => {
    expect(() => emit("const a = <div className={@@( color: {{`a${ b )>x</div>;\n")).toThrow(CssBlockError);
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
    const code = emit(`const a = <div id="x" className={@@( display: flex; )}>y</div>;\n`)?.code;

    expect(code).toContain(`<div id="x" className={_s0}>y</div>`);
  });

  /** The same CSS is the same class however the site was written — the value has one identity. */
  test("the spelling does not change what is compiled", () => {
    const attribute = emit(`const a = <div className={@@( display: flex; )}>y</div>;\n`);
    const value = emit(`const panel = @@( display: flex; );\n`);

    // Where each was written differs, and is the source map's business, not the rule's.
    const rules = (result: typeof value) => result?.blocks.map(({ origin: _origin, ...rule }) => rule);
    expect(rules(value)).toEqual(rules(attribute));
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
    expect(() => emit(`const slide = @@keyframes( from { opacity: $(n); } );\n`)).toThrow(/hole/);
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
 * - `animation: $(slide) 3s` becomes `animation: var(--r-…-0) 3s` and a value set per element, for
 *   a string that was decided at build time;
 * - `var($(angle))` becomes `var(var(--r-…-0))`, and **`var()` takes a literal name**, not another
 *   `var()`. Measured in Chromium: nothing resolves, and the declaration is dropped.
 *
 * So a hole whose expression is exactly the binding of a named site in the same file is not a hole
 * at all. It is that name, written in.
 */
describe("a reference to a named site", () => {
  /**
   * `animation` is a SPLIT family, so the block is the longhands it sets and the name is one of
   * them. What this asks is unchanged and is the point: the keyframes' own class name reaches the
   * CSS as a literal, with no custom property standing between them.
   */
  test("is written in, and costs no custom property", () => {
    const out = emit(
      `const slide = @@keyframes( from { opacity: 0; } );\nconst card = @@( animation: $(slide) 3s; );\n`,
    );

    const [frames] = out?.blocks ?? [];
    const named = out?.blocks.find((one) => one.css.startsWith("animation-name:"));

    expect(named?.css).toBe(`animation-name:${frames.className};`);
    expect(out?.blocks.some((one) => one.css === "animation-duration:3s;")).toBe(true);
    expect(out?.blocks.every((one) => one.properties.length === 0)).toBe(true);
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
        `const card = @@( transform: rotate(var($(angle))); );\n`,
    );

    const [property, card] = out?.blocks ?? [];
    expect(card.css).toBe(`transform:rotate(var(${property.className}));`);
    expect(card.properties).toEqual([]);
  });

  test("and SET by one, which is the only way a registered property is worth registering", () => {
    const out = emit(
      `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
        `const card = @@( $(angle): 45deg; );\n`,
    );

    const [property, card] = out?.blocks ?? [];
    expect(card.css).toBe(`${property.className}:45deg;`);
  });

  /** Two blocks with the same value are the same classes, so the second adds no rule at all. */
  test("two blocks referring to the same name are still one rule each", () => {
    const frames = `const slide = @@keyframes( from { opacity: 0; } );\n`;
    const one = emit(`${frames}const a = @@( animation: $(slide) 3s; );\n`);
    const two = emit(`${frames}const a = @@( animation: $(slide) 3s; );\nconst b = @@( animation: $(slide) 3s; );\n`);

    expect(two?.blocks).toHaveLength(one?.blocks.length ?? 0);
  });

  test("but blocks referring to DIFFERENT names are different rules", () => {
    const out = emit(
      `const one = @@keyframes( from { opacity: 0; } );\n` +
        `const two = @@keyframes( to { opacity: 1; } );\n` +
        `const a = @@( animation: $(one) 3s; );\n` +
        `const b = @@( animation: $(two) 3s; );\n`,
    );

    const [, , a, b] = out?.blocks ?? [];
    expect(a.className).not.toBe(b.className);
  });

  /** Anything else in a hole is a runtime value, and nothing about this makes one allowed. */
  test("an expression that is not one of them is refused as the runtime value it is", () => {
    expect(() => emit(`const card = @@( animation: $(name) 3s; );\n`)).toThrow(/match/);
  });

  /** A hole in a property name stays a refusal for everything that is not a registered property. */
  test("a hole that resolves to nothing cannot stand in a property name", () => {
    expect(() => emit(`const card = @@( $(whatever): 45deg; );\n`)).toThrow(/@@property/);
  });
});

/**
 * A named site is a VALUE, so it cannot be a JSX attribute.
 *
 * `css={@@( … )}` is rewritten from the attribute's NAME, because the braces are ours to add. A named
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
    expect(out?.blocks.map((one) => one.selector).sort()).toEqual(["", "&:hover"]);
  });

  test("a condition does too", () => {
    const out = emit(`const c = @@( padding-top: 8px; @media (min-width: 40rem) { padding-top: 8px; } );\n`);

    expect(out?.blocks).toHaveLength(2);
    expect(out?.blocks[0].className).not.toBe(out?.blocks[1].className);
  });

  test("and two different conditions are two rules again", () => {
    const out = emit(
      `const c = @@( @media print { padding-top: 8px; } @media (min-width: 40rem) { padding-top: 8px; } );\n`,
    );

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
/**
 * **The build and the checker answer the same question the same way**, including when a project has
 * switched a rule off.
 *
 * `transform` and `checkSource` are two doors onto one set of rules, and the note on the refusal
 * says why they must agree: *a fault that read differently depending on which tool found it would
 * be two faults to a reader*. A site rule is where they came apart — `checkBlock` has taken a config
 * since it had one, and the site checks never did. Fixing that in the BUILD alone left the checker
 * reporting a rule the build had been told to let through, which is the same family of mistake one
 * step along: one sibling changed, the other did not.
 *
 * Asserted as AGREEMENT rather than as two separate expectations, because that is the property —
 * either tool moving on its own is the fault.
 */
describe("the build and the checker agree about a rule a project switched off", () => {
  const SITE_RULES: [string, string, string][] = [
    ["unknown-named-block", "unknown-named-block", `const a = @@wat( color: red; );\n`],
    ["block-as-a-jsx-attribute", "block-as-a-jsx-attribute", `const a = <div className=@@( color: red; )>x</div>;\n`],
  ];

  test.each(SITE_RULES)("%s", (_what, rule, source) => {
    const config = { rules: { [rule]: "off" } } as never;

    // On: both speak.
    expect(() => transform(source, { filename: "/a.tsx" })).toThrow(CssBlockError);

    // Off: neither does.
    expect(() => transform(source, { filename: "/a.tsx", config })).not.toThrow();
    expect(checkSource(source, "/a.tsx", { config }).map((one) => one.rule)).not.toContain(rule);
  });
});

/**
 * **A directive the build cannot honour must not silence the checker either.**
 *
 * `ramonda-css-ignore` covers every rule, and `block-in-a-template` is the one it must not: a block
 * inside a `${ … }` is rewritten by nothing, so it reaches the bundler as `@@(` and the build has to
 * refuse whatever a comment says. It does. The CHECKER went quiet — measured:
 *
 *     the build,   with a directive    refused
 *     the checker, with a directive    clean
 *
 * So an author writes the comment, their editor stops complaining, `ramonda-css` says the file is
 * fine, and the build fails. That is the one direction this package says it cannot afford: an editor
 * quieter than the build promises a page the build will not give.
 *
 * It is also a claim made earlier in this review after measuring ONE door.
 */
/**
 * **The checker never ran `checkSite`**, so a bare attribute was a build failure and a clean run of
 * `ramonda-css` — which is what a project's CI runs.
 *
 * Three flows read one set of rules. `transform` calls `checkSite`, `checkNamedSite`, `checkText`
 * and `checkBlock`; `checkSource` called every one of those but the first. The editor reports it
 * through a path of its own, so the only tool that was quiet is the one a build pipeline asks.
 */
describe("the checker sees a bare attribute, the way the build does", () => {
  const BARE = `const a = <div className=@@( color: red; )>x</div>;\n`;

  test("both name it", () => {
    expect(() => transform(BARE, { filename: "/a.tsx" })).toThrow(CssBlockError);
    expect(checkSource(BARE, "/a.tsx").map((one) => one.rule)).toContain("block-as-a-jsx-attribute");
  });

  test("and both fall silent when a project switches it off", () => {
    const config = { rules: { "block-as-a-jsx-attribute": "off" } } as never;

    expect(() => transform(BARE, { filename: "/a.tsx", config })).not.toThrow();
    expect(checkSource(BARE, "/a.tsx", { config }).map((one) => one.rule)).not.toContain("block-as-a-jsx-attribute");
  });

  /** And the braced spelling stays clean in both, or this would be reporting the documented form. */
  test("while the spelling the documentation teaches is clean in both", () => {
    const braced = `const a = <div className={@@( color: red; )}>x</div>;\n`;

    expect(() => transform(braced, { filename: "/a.tsx" })).not.toThrow();
    expect(checkSource(braced, "/a.tsx")).toEqual([]);
  });
});

describe("a directive cannot silence what the build must refuse", () => {
  const IN_A_TEMPLATE = "const a = <div className={`x ${@@( color: red; )}`}>y</div>;\n";
  const WITH_A_DIRECTIVE = `// ramonda-css-ignore a vendor tool writes it this way\n${IN_A_TEMPLATE}`;

  test("the build refuses it with or without one", () => {
    expect(() => transform(IN_A_TEMPLATE, { filename: "/a.tsx" })).toThrow(CssBlockError);
    expect(() => transform(WITH_A_DIRECTIVE, { filename: "/a.tsx" })).toThrow(CssBlockError);
  });

  test("and the checker keeps reporting it, so the two agree", () => {
    expect(checkSource(IN_A_TEMPLATE, "/a.tsx").map((one) => one.rule)).toContain("block-in-a-template");
    expect(checkSource(WITH_A_DIRECTIVE, "/a.tsx").map((one) => one.rule)).toContain("block-in-a-template");
  });

  /** And an ordinary rule is still silenced, or this would be a directive that does nothing. */
  test("while an ordinary rule in the same file is still covered", () => {
    const source = `const a = @@(\n  // ramonda-css-ignore a vendor stylesheet defines this\n  dsiplay: flex;\n);\n`;

    expect(checkSource(source, "/a.tsx").map((one) => one.rule)).not.toContain("unknown-property");
  });
});

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

/**
 * **A BUILD REFUSAL NAMES ITS RULE, and it did not.**
 *
 * `ramonda-css` prints the id then the sentence — `unknown-property: \`flex-dirction\` is not …` —
 * and the BUILD printed the sentence alone. So a person whose build failed had no way to learn which
 * key to write in `ramonda.css.ts`, while a person who ran the checker did. Same fault, same tool,
 * two shapes — and the id is exactly what somebody wants at the moment a build stops them.
 *
 * It is the id and a colon, the way the checker already spells it, rather than a second wording.
 */
describe("a refusal names the rule that made it", () => {
  const refused = (source: string) => {
    try {
      transform(source, { filename: "/a.tsx" });
      return "did not refuse";
    } catch (error) {
      return (error as Error).message;
    }
  };

  test.each([
    ["unknown-property", "const a = @@(\n  flex-dirction: row;\n);\n"],
    ["unknown-value", "const a = @@(\n  color: bleu;\n);\n"],
    ["line-comment", "const a = @@(\n  // a note\n  color: red;\n);\n"],
    ["unknown-flag", "const a = @@(\n  color: red !importantt;\n);\n"],
    ["unknown-at-rule", "const a = @@(\n  @medai (min-width: 1px) { color: red; }\n);\n"],
  ])("%s is named", (id, source) => {
    const said = refused(source);

    expect(said).toContain(`${id}:`);
    // And the sentence is still there, whole.
    expect(said.length).toBeGreaterThan(id.length + 20);
  });

  /**
   * **And a key it names has to BE one**, which is the same principle from the other side.
   *
   * A fault about the SITE — where the block is written, rather than what is in it — was refused
   * with its id in front of the sentence and then ignored the `rules` key that id names. Measured:
   * `block-as-a-jsx-attribute` and `unknown-named-block` refused a build whether the project had
   * switched them off or not, while a `ramonda-css-ignore` above the line let both through and the
   * output was correct either way. Two escape hatches, one working.
   *
   * `block-in-a-template` is the one that must not be silenced — a block in a `${ … }` reaches the
   * bundler as `@@(` — and it is already right: it names no key, and neither hatch opens it.
   */
  test.each([
    ["block-as-a-jsx-attribute", `const a = <div className=@@( color: red; )>x</div>;\n`],
    ["unknown-named-block", `const a = @@wat( color: red; );\n`],
  ])("%s is a key a project can actually switch off", (id, source) => {
    expect(refused(source)).toContain(`${id}:`);
    expect(() => transform(source, { filename: "/a.tsx", config: { rules: { [id]: "off" } } })).not.toThrow();
  });

  /** And the one that names no key stays refused, because silencing it would ship `@@(`. */
  test("a block in a template cannot be switched off, and names no key", () => {
    const source = "const a = <div className={`x ${@@( color: red; )}`}>y</div>;\n";

    expect(refused(source)).not.toMatch(/^\/a\.tsx:\d+:\d+\s+[a-z-]+:/);
    expect(() =>
      transform(source, { filename: "/a.tsx", config: { rules: { "block-in-a-template": "off" } } }),
    ).toThrow();
  });

  /**
   * A refusal the PARSER makes has no rule behind it — there is no key to switch off, so naming one
   * would send a reader looking for something that is not there.
   */
  test.each([
    ["a block that cannot be read", "const a = @@(\n  color red;\n);\n"],
    ["a hole where a property belongs", "const w = 1;\nconst a = @@(\n  $(w): red;\n);\n"],
  ])("%s names no rule, because none made it", (_what, source) => {
    expect(refused(source)).not.toMatch(/^\/a\.tsx:\d+:\d+\s+[a-z-]+:/);
  });
});

/**
 * The build refuses a `@@property` the browser would drop, missing `syntax` or `inherits`, as it
 * already refused one missing `initial-value`. It does not run the type check, which says so in the
 * editor — measured, it compiled both before.
 */
describe("a @@property missing a descriptor CSS requires", () => {
  test.each([
    ["syntax", `inherits: false; initial-value: 0%;`],
    ["inherits", `syntax: "<percentage>"; initial-value: 0%;`],
  ])("without `%s` stops the build, naming it", (name, body) => {
    expect(() => transform(`const w = @@property( ${body} );\nexport default w;\n`)).toThrow(
      new RegExp(`property-descriptor-missing: .*has no \`${name}\``),
    );
  });
});

/**
 * A condition written at the wrong level is refused with the spelling that level takes.
 *
 * `when` chooses a group and the choice chooses a value — the composing page's table. Written the
 * other way round, the build refused all three, but with a sentence about something else: `color`
 * not accepting the word `when`, braces versus `$( )`, a hole as a declaration. The editor and the
 * build must say the same, so both are asked.
 */
describe("a condition at the wrong level", () => {
  const block = (body: string) => `declare const a: boolean;\nconst x = @@( ${body} );\nexport default x;\n`;
  const editor = (body: string) => checkSource(block(body), "/a.tsx", { tolerant: true }).map((one) => one.message);

  test.each([
    ["`when` in a value", `color: when $(a) red;`],
    ["`when … else` in a value", `color: when $(a) { red } else { blue };`],
  ])("%s names the choice", (_what, body) => {
    expect(() => transform(block(body))).toThrow(/`when` chooses a group — for a value, write `\$\(c\) \? a : b`/);
    expect(editor(body)).toEqual([
      expect.stringContaining("`when` chooses a group — for a value, write `$(c) ? a : b`"),
    ]);
  });

  test.each([
    ["in parens", `$(a) ? ( color: red; ) : ( color: blue; );`],
    ["in braces", `$(a) ? { color: red; } : { color: blue; }`],
  ])("a choice over groups, %s, names `when`", (_what, body) => {
    expect(() => transform(block(body))).toThrow(
      /a choice picks a value — for a group, write `when \$\(c\) \{ … \} else \{ … \}`/,
    );
    expect(editor(body)).toEqual([
      expect.stringContaining("a choice picks a value — for a group, write `when $(c) { … } else { … }`"),
    ]);
  });
});
