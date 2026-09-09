import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { checkProject } from "../check";

/**
 * The check command's own half: a real tsconfig, real files on disk, a real `ts.Program`.
 *
 * **Without this the type safety is a claim about editors rather than about CI.** So the assertions
 * that matter are the two a build depends on: a project with a wrong block reports it at the
 * author's own line, and a project with a right one reports nothing at all.
 *
 * Every project below resolves `@ramonda/css/properties` through `paths`, which is what a real
 * project gets from `node_modules` — so the map under test is the one that ships.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const JSX_TYPES = `
declare namespace JSX {
  interface IntrinsicElements {
    div: { className?: string; css?: unknown; children?: unknown };
  }
  interface Element { readonly _brand: unique symbol }
}
`;

const projects: string[] = [];

afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

/**
 * A project on disk, with the files given, and the tsconfig a real one would have.
 *
 * `shape` says where `@ramonda/css/properties` resolves to. The default is the map that ships;
 * pointing it at nothing is how a broken setup is measured.
 */
function project(files: Record<string, string>, shape: string | null = join(PACKAGE, "src", "properties.ts")): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-"));
  projects.push(root);

  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "jsx.d.ts"), JSX_TYPES);
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, "src", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "preserve",
        types: [],
        skipLibCheck: true,
        baseUrl: ".",
        // What `node_modules` gives a real project. Written out so the map under test is the
        // package's own rather than a fixture.
        ...(shape === null ? {} : { paths: { "@ramonda/css/properties": [shape] } }),
      },
      include: ["src"],
    }),
  );

  return join(root, "tsconfig.json");
}

const check = (files: Record<string, string>) => checkProject(project(files));

describe("a file that only looked like it held a block", () => {
  /**
   * The cheap first pass is allowed to say maybe — a string or a comment can hold the syntax, and this
   * A file that turns out to hold no block needs no overlay and no mapping, and its diagnostics are
   * its own.
   */
  test("a decorator is not a block, and the file is checked as it is", () => {
    const report = check({
      "Dec.ts": `declare const dec: (x: unknown, c: unknown) => void;\nexport class C {\n  @(dec) m() {}\n}\nexport const n: number = "no";\n`,
    });

    expect(report.styled).toBe(0);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(5);
  });
});

describe("a project that is right", () => {
  test("reports nothing, and says how much of it carries a block", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div className="lead" css=@@(\n    display: flex;\n    gap: 8px;\n  )>x</div>\n);\nexport default a;\n`,
      "Plain.tsx": `const b = <div>x</div>;\nexport default b;\n`,
    });

    expect(report.findings).toEqual([]);
    expect(report.refused).toBe(false);
    expect(report.styled).toBe(1);
    expect(report.files).toBe(3);
  });

  test("a hole reads the class it was written in", () => {
    const report = check({
      "Card.tsx": `export class Card {\n  accent = "#10b981";\n  render() {\n    return <div css=@@( border-left: 4px solid {this.accent}; )>x</div>;\n  }\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

describe("a project that is not", () => {
  test("a property typo is reported at the author's own line and column", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div css=@@(\n    dsiplay: flex;\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    const [only] = report.findings;
    expect(only.file).toMatch(/Card\.tsx$/);
    expect(only.line).toBe(3);
    expect(only.column).toBe(5);
    expect(only.message).toContain("Did you mean to write 'display'?");
  });

  /**
   * TWO findings, and the second one is the price of checking the hole itself — see `__val` in
   * `virtual.ts`.
   *
   * `position` is one of the 127 properties whose grammar is a closed keyword set, so its own type
   * was already refusing a boolean. Wrapping the hole adds a `TS2345` naming the real type, on the
   * hole; and because inference then fails, `T` falls back to its constraint and the property's own
   * `TS2322` comes back saying `CssValue` rather than `boolean`.
   *
   * **Measured before choosing this shape.** `<T>(v: T & CssValue): T` keeps the real type in the
   * second message — and gives two findings for the other 424 properties too, where this gives one,
   * because the fallback to `CssValue` is exactly what satisfies an open property and stays quiet.
   * One confusing message on a quarter of properties beat a second message on all of them.
   */
  test("a hole whose type the property cannot take is reported, on the hole and on the property", () => {
    const report = check({
      "Card.tsx": `export class Card {\n  wide = true;\n  render() {\n    return <div css=@@( position: {this.wide}; )>x</div>;\n  }\n}\n`,
    });

    expect(report.findings).toHaveLength(2);
    expect(report.findings.every((one) => one.line === 4)).toBe(true);
    const [onTheHole] = report.findings.filter((one) => one.code === 2345);
    expect(onTheHole.message).toContain("boolean");
    expect(report.findings.some((one) => one.code === 2322)).toBe(true);
  });

  /** And an OPEN property — 424 of the 551 — reports the hole once, with the type the author wrote. */
  test("a hole in an open property is reported once", () => {
    const report = check({
      "Card.tsx": `export class Card {\n  wide = true;\n  render() {\n    return <div css=@@( color: {this.wide}; )>x</div>;\n  }\n}\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe(2345);
    expect(report.findings[0].line).toBe(4);
    expect(report.findings[0].message).toContain("boolean");
  });

  /**
   * A project using this syntax cannot run plain `tsc` — the compiler refuses the file at the parse
   * step — so this IS its `tsc`. A report that dropped ordinary type errors would look like a
   * passing check on a program nothing checked.
   */
  test("an ordinary type error in a file with a block is reported too", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = <div css=@@( display: flex; )>x</div>;\nexport default [n, a];\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(1);
    expect(report.findings[0].code).toBe(2322);
  });

  test("and one in a file with no block at all", () => {
    const report = check({
      "Card.tsx": `const a = <div css=@@( display: flex; )>x</div>;\nexport default a;\n`,
      "Plain.ts": `export const n: number = "no";\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].file).toMatch(/Plain\.ts$/);
  });

  /**
   * TypeScript reports one failure per object literal and stops. Measured: a block written as ONE
   * literal with three faults reported one of them, and the author met the next on the next run. So
   * the virtual file writes one literal per declaration, gathered in an array, and every fault in a
   * block arrives at once — nested rules included.
   */
  test("every fault in one block is reported at once, each at its own line", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div css=@@(\n    dsiplay: flex;\n    position: statik;\n    &:hover {\n      colr: red;\n    }\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings.map((f) => f.line)).toEqual([3, 4, 6]);
    expect(report.findings[0].message).toContain("Did you mean to write 'display'?");
    expect(report.findings[1].message).toContain(`Did you mean '"static"'?`);
    expect(report.findings[2].message).toContain("Did you mean to write 'color'?");
  });

  test("two files each report their own", () => {
    const report = check({
      "One.tsx": `const a = <div css=@@( dsiplay: flex; )>x</div>;\nexport default a;\n`,
      "Two.tsx": `const b = <div css=@@( positon: absolute; )>x</div>;\nexport default b;\n`,
    });

    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((f) => f.file.replace(/.*\//, "")).sort()).toEqual(["One.tsx", "Two.tsx"]);
  });
});

describe("the CSS rules, beside the type errors", () => {
  /**
   * Two kinds of finding in one list on purpose: an author reads a FILE, not a tool, and a property
   * typo beside a type error is one list of things to fix.
   */
  test("a fault only the rules can see is reported", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div css=@@(\n    display: flexx;\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-value");
    expect(report.findings[0].line).toBe(3);
    expect(report.findings[0].message).toContain("Did you mean `flex`?");
  });

  test("both kinds arrive in the order a person reads the file", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = (\n  <div css=@@(\n    display: flexx;\n  )>x</div>\n);\nexport default [n, a];\n`,
    });

    expect(report.findings.map((finding) => [finding.line, finding.code])).toEqual([
      [1, 2322],
      [4, "unknown-value"],
    ]);
  });

  /**
   * `TS2353` is *"does not exist in type"*, which is exactly what `unknown-property` says — and the
   * rule says it with the near miss the compiler cannot offer, because a quoted object key gets no
   * suggestion. Measured before this: `flex-dirction` came back twice, once usefully.
   */
  test("and the compiler's word is dropped where a rule of ours said it better", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div css=@@(\n    flex-dirction: row;\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-property");
    expect(report.findings[0].message).toContain("flex-direction");
  });

  test("a TS2353 about something no rule named is still reported", () => {
    // A `@font-face` descriptor that is not one. `DESCRIPTORS` is a near-miss search, and `nope`
    // is near nothing, so no rule of ours claims it and the compiler's word is all there is.
    const report = check({
      "Face.tsx": `const f = @@font-face(\n  src: url(a.woff2);\n  nope: 1;\n);\nexport default f;\n`,
    });

    expect(report.findings.some((finding) => finding.code === 2353)).toBe(true);
  });
});

describe("a block that cannot be read at all", () => {
  /**
   * A refusal is a syntax error, and a compiler does not type-check a program it could not parse.
   * Carrying on would mean serving `tsc` either the unreadable file — a cascade of parse errors
   * nobody wrote — or a stub, which turns one real fault into a screen of "has no exported member".
   */
  test("is reported alone, and nothing is type-checked", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = <div css=@@(\n  {name}: 24px;\n)>x</div>;\nexport default [n, a];\n`,
    });

    expect(report.refused).toBe(true);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe(0);
    expect(report.findings[0].line).toBe(3);
    expect(report.findings[0].message).toContain("a hole cannot be a whole declaration");
  });
});

describe("a setup that would otherwise pass silently", () => {
  /**
   * The preamble declares the helper against `CssBlockShape`. If that cannot be resolved — the
   * package not installed, `paths` not set, the export renamed — every block becomes `any` and
   * NOTHING is checked. Dropping the one diagnostic that says so, the way every other scaffolding
   * diagnostic is dropped, would turn a broken setup into a passing run.
   */
  test("a block shape that does not resolve is reported, not dropped", () => {
    const report = checkProject(
      project({ "Card.tsx": `const a = <div css=@@( dsiplay: flex; )>x</div>;\nexport default a;\n` }, null),
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("@ramonda/css/properties");
    expect(report.findings[0].line).toBe(1);
  });

  test("an export that is not there is reported the same way", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-"));
    projects.push(root);
    writeFileSync(join(root, "empty.ts"), "export const nothing = 1;\n");

    const report = checkProject(
      project(
        { "Card.tsx": `const a = <div css=@@( display: flex; )>x</div>;\nexport default a;\n` },
        join(root, "empty.ts"),
      ),
    );

    // Five, because the virtual file names five types from that module — the block's shape, what a
    // block IS, composition's two, and what a hole in a value must be. Each missing one is its own
    // setup fault, and each is reported.
    expect(report.findings).toHaveLength(5);
    expect(report.findings.map((one) => one.message).join(" ")).toContain("CssBlockShape");
  });

  test("and it is reported once, whatever the project's size", () => {
    const files: Record<string, string> = {};
    for (let n = 0; n < 4; n++)
      files[`C${n}.tsx`] = `const a${n} = <div css=@@( display: flex; )>x</div>;\nexport default a${n};\n`;

    const report = checkProject(project(files, null));

    expect(report.findings).toHaveLength(1);
  });
});

describe("the configuration itself", () => {
  test("a tsconfig that is not there is a finding, not a crash", () => {
    const report = checkProject(join(tmpdir(), "ramonda-css-nothing-here", "tsconfig.json"));

    expect(report.refused).toBe(true);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("Cannot read file");
  });

  test("a diagnostic with no file at all is still a reason to fail", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-"));
    projects.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { types: ["nothing-is-here"] }, include: ["src"] }),
    );

    const report = checkProject(join(root, "tsconfig.json"));

    expect(report.refused).toBe(false);
    expect(report.findings[0].message).toContain("nothing-is-here");
    expect(report.findings[0].file).toMatch(/tsconfig\.json$/);
  });

  test("a tsconfig that names an option that does not exist is reported", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-"));
    projects.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "NOPE" }, include: ["src"] }),
    );

    const report = checkProject(join(root, "tsconfig.json"));

    expect(report.refused).toBe(true);
    // The compiler's own words, not ours — a configuration fault is still a reason to fail.
    expect(report.findings[0].message).toContain("--target");
  });
});

/**
 * A named site — `@@keyframes( … )`, `@@font-face( … )`, `@@property( … )` — through a real program.
 *
 * These are the blocks that are not a list of properties, and the whole reason they get their own
 * surfaces: `src` is not a property, `from` is not a selector, and typing either against the
 * property map would report correct CSS on every line. What is asserted here is that each body is
 * checked against its OWN vocabulary, and that a descriptor a rule cannot be written for — one that
 * is simply missing — is caught by the type instead.
 */
describe("a named site", () => {
  test("frames hold ordinary properties, and a typo in one is reported at its own line", () => {
    const report = check({
      "Slide.tsx": `export const slide = @@keyframes(\n  from { opacity: 0; }\n  to { opacty: 1; }\n);\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(3);
    expect(report.findings[0].message).toContain("opacity");
  });

  test("and a right one reports nothing", () => {
    const report = check({
      "Slide.tsx": `export const slide = @@keyframes(\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; }\n);\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a font face is checked against its descriptors, not against the properties", () => {
    const report = check({
      "Face.tsx": `export const brand = @@font-face(\n  font-family: "Brand";\n  src: url("/brand.woff2") format("woff2");\n  font-display: swap;\n);\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** The one a rule could not ask: nothing is wrong on any line, and the whole rule loads nothing. */
  test("a font face with no `src` is reported, because the descriptor is required", () => {
    const report = check({
      "Face.tsx": `export const brand = @@font-face(\n  font-family: "Brand";\n);\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("src");
  });

  test("a descriptor typo is reported like a property typo", () => {
    const report = check({
      "Face.tsx": `export const brand = @@font-face(\n  font-familly: "Brand";\n  src: url("/brand.woff2");\n);\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(2);
    expect(report.findings[0].message).toContain("font-family");
  });

  /** Measured in Chromium: without `inherits` the rule does not appear in `cssRules` at all. */
  test("a registered property with no `inherits` is reported, because the browser drops the rule", () => {
    const report = check({
      "Angle.tsx": `export const angle = @@property(\n  syntax: "<angle>";\n  initial-value: 45deg;\n);\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("inherits");
  });

  test("and a complete one reports nothing", () => {
    const report = check({
      "Angle.tsx": `export const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 45deg;\n);\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a property whose syntax is `*` needs no initial value", () => {
    const report = check({
      "Any.tsx": `export const any = @@property(\n  syntax: "*";\n  inherits: false;\n);\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

/**
 * A reference to a named site, through the type checker.
 *
 * The transform writes these in at build time, and the check has to read the file the same way or it
 * reports a fault the build does not have — `{{angle}}: 45deg` is a hole in a property name, which
 * is refused everywhere except here.
 */
describe("a reference to a named site", () => {
  test("reading one in a value is not a fault", () => {
    const report = check({
      "Card.tsx": `const slide = @@keyframes(\n  from { opacity: 0; }\n);\nconst card = @@( animation: {slide} 3s; );\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and setting a registered property by name is not either", () => {
    const report = check({
      "Card.tsx": `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\nconst card = @@( {angle}: 45deg; );\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("while a hole in a name that stands for nothing is still reported", () => {
    const report = check({
      "Card.tsx": `const card = @@( {whatever}: 45deg; );\nexport { card };\n`,
    });

    expect(report.findings.length).toBeGreaterThan(0);
  });
});

/**
 * What has to stay at the TOP of the author's file, because TypeScript reads it there or not at all.
 *
 * The virtual file writes a `declare` in front of the author's text, and that used to go before
 * everything — including the leading comments, which is where two directives live and are the only
 * place they work:
 *
 * | written | what happened |
 * |---|---|
 * | `// @ts-nocheck` | ignored — every error in a file the author switched off came back |
 * | `/// <reference types="…" />` | **dropped**, so the types it pulls in were missing and the check reported code that is fine |
 *
 * Both are false reports, which is the one failure a checker does not survive. The leading trivia is
 * copied first now and the `declare` goes after it, at the start of the line the author's first
 * statement was already on — so the line numbers are the same and the directives are still first.
 */
describe("a file whose first lines are directives", () => {
  test("`@ts-nocheck` switches the file off, block and all", () => {
    const report = check({
      "Card.tsx": `// @ts-nocheck\nconst n: number = "no";\nconst a = <div css=@@( display: flex; )>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and it does not switch off a file that never asked", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = <div css=@@( display: flex; )>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
  });

  /**
   * OUTSIDE `include`, or the test proves nothing: a `.d.ts` beside the sources is in the program
   * anyway, and the first version of this passed with the reference already broken.
   */
  test("a triple-slash reference still pulls its types in", () => {
    const report = check({
      "../outside/globals.d.ts": `declare const PLANTED: string;\n`,
      "Card.tsx": `/// <reference path="../outside/globals.d.ts" />\nconst a = <div css=@@( display: flex; )>{PLANTED}</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a licence header above a block does not move anything", () => {
    const report = check({
      "Card.tsx": `/*\n * Copyright somebody.\n */\nconst a = <div css=@@(\n  dsiplay: flex;\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(5);
  });
});

/**
 * Composition, through a real program — the two new places an author can be wrong.
 *
 * Both are caught by a TYPE rather than by a rule of ours, which means TypeScript's own message at
 * the author's own position and no diagnostic to write. And what the block already had must survive:
 * a typo inside `@@if` is the same `TS2561` it is outside one.
 */
describe("a conditional group", () => {
  test("an ordinary condition is not a fault", () => {
    const report = check({
      "Card.tsx": `class C {\n  off = false;\n  r() {\n    return <div css=@@( cursor: pointer; @@if ({this.off}) { cursor: not-allowed; } )>x</div>;\n  }\n}\nexport default C;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and so is one that may be missing, which is the shape a prop has", () => {
    const report = check({
      "Card.tsx": `declare const maybe: { a: 1 } | undefined;\nconst a = <div css=@@( @@if ({maybe}) { opacity: 0.5; } )>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** A condition that can never be false is a group that can never be off. */
  test.each([
    [
      "a method that was not called",
      `class C { off() {} r() { return <div css=@@( @@if ({this.off}) { opacity: 0.5; } )>x</div>; } }`,
    ],
    ["an object", `declare const o: { a: 1 };\nconst a = <div css=@@( @@if ({o}) { opacity: 0.5; } )>x</div>;`],
    ["a promise", `declare const p: Promise<number>;\nconst a = <div css=@@( @@if ({p}) { opacity: 0.5; } )>x</div>;`],
    // **Measured and MISSED before this line existed.** The check asked whether the type was an
    // object, and a literal is not one — so every one of these passed while never being false.
    ["a string literal", `declare const s: "yes";\nconst a = <div css=@@( @@if ({s}) { opacity: 0.5; } )>x</div>;`],
    ["a union of them", `declare const s: "a" | "b";\nconst a = <div css=@@( @@if ({s}) { opacity: 0.5; } )>x</div>;`],
    ["a union of numbers", `declare const n: 1 | 2;\nconst a = <div css=@@( @@if ({n}) { opacity: 0.5; } )>x</div>;`],
    [
      "a template type that cannot be empty",
      `declare const t: \`x\${string}\`;\nconst a = <div css=@@( @@if ({t}) { opacity: 0.5; } )>x</div>;`,
    ],
    [
      "an array, which is an object wearing a length",
      `declare const xs: number[];\nconst a = <div css=@@( @@if ({xs}) { opacity: 0.5; } )>x</div>;`,
    ],
  ])("%s is reported, because it is always truthy", (_what, code) => {
    const report = check({ "Card.tsx": `${code}\nexport {};\n` });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toMatch(/always truthy/);
  });

  /**
   * What must stay allowed, because truthiness is the QUESTION rather than an accident.
   *
   * `@@if` is an `if`, and a condition that can be false is a condition. Requiring `boolean` would
   * refuse `items.length`, which is exactly the shape a person reaches for — so the type refuses
   * only what can never be off, and lets everything else through.
   */
  test.each([
    ["a boolean", "declare const b: boolean;", "b"],
    ["one that may be missing", "declare const b: boolean | undefined;", "b"],
    ["a number, because 0 is false", "declare const n: number;", "n"],
    ["a length, which is the usual reason", "declare const xs: number[];", "xs.length"],
    ["a string, because empty is false", "declare const s: string;", "s"],
    ["an object that may be missing", "declare const o: { a: 1 } | undefined;", "o"],
    ["a comparison", "declare const n: number;", "n > 2"],
  ])("%s is allowed", (_what, declare, expression) => {
    const report = check({
      "Card.tsx": `${declare}\nconst a = <div css=@@( @@if ({${expression}}) { opacity: 0.5; } )>x</div>;\nexport {};\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a typo inside a group is the same fault it is outside one", () => {
    const report = check({
      "Card.tsx": `declare const c: boolean;\nconst a = <div css=@@(\n  @@if ({c}) {\n    dsiplay: flex;\n  }\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(4);
    expect(report.findings[0].message).toContain("display");
  });

  /**
   * **The condition is its own element, not an argument wrapping the group**, and this is the test
   * that decided it: measured, writing the group as `__when(condition, [ … ])` meant a wrong
   * condition HID every fault under it — the failed inference degrades the whole call.
   */
  test("a wrong condition does not hide the faults under it", () => {
    const report = check({
      "Card.tsx": `declare const o: { a: 1 };\nconst a = <div css=@@(\n  @@if ({o}) {\n    dsiplay: flex;\n    colr: red;\n  }\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(3);
    expect(report.findings.map((one) => one.line)).toEqual([3, 4, 5]);
  });
});

describe("a spread", () => {
  test("of a block is not a fault", () => {
    const report = check({
      "Card.tsx": `const base = @@( display: flex; );\nconst a = <div css=@@( ...{base}; opacity: 0.5; )>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("of something that is not a block is reported", () => {
    const report = check({
      "Card.tsx": `declare const plain: { color: string };\nconst a = <div css=@@( ...{plain}; )>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toMatch(/style block/);
  });

  test("and the fault lands on the expression the author wrote", () => {
    const report = check({
      "Card.tsx": `declare const plain: string;\nconst a = <div css=@@(\n  display: flex;\n  ...{plain};\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings[0].line).toBe(4);
  });
});

/**
 * What a block's own binding LOOKS like when you hover it.
 *
 * The virtual file's helper returned `never`, which is assignable everywhere and so never got in the
 * way — and read, in an editor, as *this is nothing*. A binding holding a block is the one thing an
 * author points at to ask what a block IS, so the answer has to be the value the `css` prop takes.
 *
 * Branded, and that is not decoration: a hand-written object with the same three fields is not a
 * compiled block. It has no map behind it, so spreading one would compose nothing — quietly, which
 * is the failure this package keeps finding.
 */
/**
 * WHAT A HOLE MAY EVALUATE TO, asked of the hole rather than of the property it sits in.
 *
 * `types.ts` excludes `undefined` on purpose and says why: measured against a real server render, a
 * hole that is `undefined` on the server and a value on the client is repaired silently, and the
 * other direction is reported as a divergence and **not** repaired. Two paths let it back in.
 *
 * - `CssBlockShape` is a `Partial`, and optionality puts `| undefined` back on every property. So
 *   `color: {maybe}` passed — for the 424 properties whose type is `CssValue`. The 127 closed ones
 *   caught it by accident, because they refuse a bare `string` too.
 * - A value that is TEXT AND HOLES is written as a template literal, which accepts anything at all.
 *   Nothing here was checked: not `undefined`, not `null`, not an object, not a function's `void`.
 *
 * The user asked for this in as many words: a hole may not be nullable, so a fallback has to be
 * written. `exactOptionalPropertyTypes` was measured first and refused — it also reports the
 * author's own ordinary code, which would be a false report under their own settings.
 */
describe("what a hole may evaluate to", () => {
  const held = (declaration: string, head: string) =>
    check({ "Card.tsx": `${head}const a = <div css=@@(\n  ${declaration}\n)>x</div>;\nexport default a;\n` });

  test.each([
    ["undefined", "  color: {maybe};", "declare const maybe: string | undefined;\n"],
    ["null", "  color: {nul};", "declare const nul: string | null;\n"],
    ["an object", "  color: {obj};", "declare const obj: { a: number };\n"],
    ["a function's void", "  color: {f()};", "declare function f(): void;\n"],
    ["undefined, inside a value", "  border-left: {maybe} solid red;", "declare const maybe: string | undefined;\n"],
    ["an object, inside a value", "  border-left: {obj} solid red;", "declare const obj: { a: number };\n"],
  ])("%s is refused", (_what, declaration, head) => {
    const report = held(declaration, head);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe(2345);
    // On the author's own expression, which is what makes it actionable — and what settled the
    // shape: `satisfies` reports the same faults on the `satisfies` clause, text this file wrote,
    // so `homeOf` maps it nowhere and the author never sees it. Measured, both ways.
    expect(report.findings[0].line).toBe(3);
    expect(report.findings[0].column).toBeGreaterThan(9);
  });

  test.each([
    ["a fallback is written", '  color: {maybe ?? "red"};', "declare const maybe: string | undefined;\n"],
    ["a plain string", "  color: {s};", "declare const s: string;\n"],
    ["a number", "  opacity: {n};", "declare const n: number;\n"],
    ["a closed property's own keyword", "  position: {k};", 'declare const k: "absolute";\n'],
    ["a string inside a value", "  border-left: {s} solid red;", "declare const s: string;\n"],
  ])("%s is accepted", (_what, declaration, head) => {
    expect(held(declaration, head).findings).toEqual([]);
  });

  /** A guard and a spread are not values, so neither goes through it — each has a type of its own. */
  test("a hole in a condition is still any expression at all", () => {
    expect(held("  @@if ({on}) { color: red; }", "declare const on: boolean;\n").findings).toEqual([]);
  });
});

/**
 * WHAT THE EDITOR AND THE BUILD MUST AGREE ABOUT.
 *
 * Three shapes were green here and refused by `transform`, which is the worst arrangement of the
 * two: the check a person runs says yes and the build that runs later says no.
 *
 * Two were refusals the transform made on its own, where `checkBlock` is the seam both paths read —
 * the same gap, one rule earlier, that let a `@property` inside a block reach a real Vite build. The
 * third was the reverse: `div { … }` is legal CSS the build compiles, and the editor called it a
 * `TS2353`, because the virtual file wrote the author's prelude as the object key while `flatten`
 * had already decided a prelude naming no parent means `& div`.
 */
describe("the editor and the build, on the same file", () => {
  test.each([
    [
      "a spread inside a selector",
      "const base = @@( color: red; );\nconst a = <div css=@@(\n  &:hover { ...{base}; }\n)>x</div>;\nexport default a;\n",
      "spread-out-of-place",
    ],
    [
      "a spread inside a `@media`",
      "const base = @@( color: red; );\nconst a = <div css=@@(\n  @media print { ...{base}; }\n)>x</div>;\nexport default a;\n",
      "spread-out-of-place",
    ],
    [
      "a hole inside `@@keyframes`",
      "declare const w: number;\nconst k = @@keyframes(\n  from { opacity: {w}; }\n);\nexport default k;\n",
      "hole-in-a-named-block",
    ],
  ])("%s is reported here too, not only at build", (_what, source, rule) => {
    const report = check({ "Card.tsx": source });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe(rule);
  });

  test.each([
    ["a bare element selector", "  div { color: red; }"],
    ["a class selector", "  .title { color: red; }"],
    ["a descendant of a pseudo", "  &:hover div { color: red; }"],
    ["a spread at the top level", "  ...{base};"],
    ["a spread inside `@@if`, which changes no key", "  @@if ({on}) { ...{base}; }"],
    ["a hole in an ordinary block", "  opacity: {w};"],
  ])("%s is accepted here, as the build accepts it", (_what, body) => {
    const report = check({
      "Card.tsx":
        `const base = @@( color: red; );\ndeclare const on: boolean;\ndeclare const w: number;\n` +
        `const a = <div css=@@(\n${body}\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** And a typo inside a bare selector is still the typo it was — the key changed, not the check. */
  test("a property typo inside a bare selector is still caught", () => {
    const report = check({
      "Card.tsx": `const a = <div css=@@(\n  div { colr: red; }\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("color");
  });
});

/**
 * A `var()` reading a name nothing in the PROJECT sets, which only this command and a build can see.
 *
 * `variable-read-by-another-name` guesses at it from inside one block: it speaks when a read is a
 * few edits from a name the SAME block sets. That made it blind to a name set three components away
 * and loud whenever a project's global name resembled a local one — the report this came from.
 *
 * Reported as a finding at the name's own position, not as a refusal: a refusal means the parser
 * could not read a block, and saying that about a name that reads perfectly well sends a person
 * looking at the wrong thing.
 */
describe("a variable nothing in the project sets", () => {
  test("is reported, at the name and with every way to fix it", () => {
    const report = check({
      "Card.tsx": `const a = <div css=@@(\n  color: var(--brand);\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("variable-not-set");
    expect(report.findings[0].line).toBe(2);
    expect(report.findings[0].column).toBe(14);
    expect(report.findings[0].message).toContain("nothing in this build sets `--brand`");
    expect(report.findings[0].message).toContain("fallback");
  });

  test("a name ANOTHER file sets is fine, which is why this is asked here at all", () => {
    const report = check({
      "Theme.tsx": `const t = <div css=@@(\n  --brand: #10b981;\n)>x</div>;\nexport default t;\n`,
      "Card.tsx": `const a = <div css=@@(\n  color: var(--brand);\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test.each([
    ["the same block sets it", "  --brand: #10b981;\n  color: var(--brand);"],
    ["a fallback says it may be absent", "  color: var(--brand, #10b981);"],
    ["a `@@property` registers it", ""],
  ])("%s", (_what, body) => {
    const report = check({
      "Card.tsx":
        body === ""
          ? `const brand = @@property(\n  syntax: "<color>";\n  inherits: true;\n  initial-value: #10b981;\n);\n` +
            `const a = <div css=@@(\n  color: var({brand});\n)>x</div>;\nexport default [brand, a];\n`
          : `const a = <div css=@@(\n${body}\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** The suggestion comes from every name in the project now, not from the one block's own. */
  test("a near miss in another file is offered", () => {
    const report = check({
      "Theme.tsx": `const t = <div css=@@(\n  --accent: #10b981;\n)>x</div>;\nexport default t;\n`,
      "Card.tsx": `const a = <div css=@@(\n  color: var(--ackcent);\n)>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("Did you mean `--accent`?");
  });
});

describe("the type a block has", () => {
  test("a binding holding a block is a block, not `never`", () => {
    const report = check({
      "Card.tsx":
        `const panel = @@( display: flex; );\n` +
        `const named: import("@ramonda/css/properties").CssBlock = panel;\n` +
        `export { named };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and it still goes where a compiled value goes", () => {
    const report = check({
      "Card.tsx": `const panel = @@( display: flex; );\nconst a = <div css={panel}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a hand-written object with the same fields is not one", () => {
    const report = check({
      "Card.tsx":
        `const forged = { className: "r-x", properties: [], values: [] };\n` +
        `const a = <div css=@@( ...{forged}; )>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toMatch(/style block/);
  });
});

/**
 * WHICH config a file is checked against, which was one answer for a whole tsconfig.
 *
 * Reading it from beside the tsconfig was already better than reading it from the shell's
 * directory, and it is still the wrong unit: one tsconfig in a monorepo names files in several
 * packages, and a package's own `ramonda.css.ts` is the file the EDITOR reads for those files. Two
 * tools, one source file, two sets of units — with the author told the build agrees. Anchored on
 * the file, they cannot disagree. See `configReader`.
 */
describe("which config a file is checked against", () => {
  const SOURCE = `const a = <div css=@@(\n  padding: 1em;\n)>x</div>;\nexport default a;\n`;

  test("each package's own, inside one project", () => {
    const report = check({
      "web/ramonda.css.ts": `export default { units: ["px"] };\n`,
      "web/Card.tsx": SOURCE,
      "admin/ramonda.css.ts": `export default { units: ["px", "em"] };\n`,
      "admin/Card.tsx": SOURCE,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].file).toMatch(/web[/\\]Card\.tsx$/);
    expect(report.findings[0].message).toContain("px");
  });

  /** And the shared one above them still governs a package that has none of its own. */
  test("the root's config, for a package that does not have one", () => {
    const report = check({
      "ramonda.css.ts": `export default { units: ["px"] };\n`,
      "web/Card.tsx": SOURCE,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("px");
  });
});
