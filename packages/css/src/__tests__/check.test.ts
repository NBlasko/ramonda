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
    div: { id?: string; className?: string; children?: unknown };
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
      "Card.tsx": `const a = (\n  <div id="lead" className={@@(\n    display: flex;\n    gap: 8px;\n  )}>x</div>\n);\nexport default a;\n`,
      "Plain.tsx": `const b = <div>x</div>;\nexport default b;\n`,
    });

    expect(report.findings).toEqual([]);
    expect(report.refused).toBe(false);
    expect(report.styled).toBe(1);
    expect(report.files).toBe(3);
  });

  /**
   * The same class, with the value declared rather than injected — which is what replaced the hole.
   * The block reads the registered name and the element sets it, so nothing is built per render.
   */
  test("a registered property is read by a block and set on the element", () => {
    const report = check({
      "Card.tsx":
        `const accent = @@property(\n  syntax: "<color>";\n  inherits: false;\n  initial-value: #10b981;\n);\n` +
        `export const tint = (value: string) => ({ [accent]: value });\n` +
        `export class Card {\n  render() {\n` +
        `    return <div className={@@( border-left: 4px solid var($(accent)); )}>x</div>;\n` +
        `  }\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

describe("a project that is not", () => {
  test("a property typo is reported at the author's own line and column", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div className={@@(\n    dsiplay: flex;\n  )}>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    const [only] = report.findings;
    expect(only.file).toMatch(/Card\.tsx$/);
    expect(only.line).toBe(3);
    expect(only.column).toBe(5);
    expect(only.message).toContain("Did you mean `display`?");
  });

  /**
   * ONE finding for a hole, and it is ours.
   *
   * It used to be one for a hole whose TYPE the property could not take — `position: $(this.wide)`
   * with a boolean — and a long note weighing which of the compiler's two messages to keep. The
   * hole is refused outright now, so the weighing is gone with it: `hole-not-allowed` is the only
   * thing said, whether or not the expression would also have failed its type.
   *
   * Both halves are asserted, closed and open, because the pair used to differ between them: 127
   * properties have a closed keyword set and reported twice, and the other 424 reported once.
   */
  test.each([
    ["a closed property", "position"],
    ["an open one", "color"],
  ])("a hole in %s is reported once, by us, wherever its type would have landed", (_what, property) => {
    const report = check({
      "Card.tsx": `export class Card {\n  wide = true;\n  render() {\n    return <div className={@@( ${property}: $(this.wide); )}>x</div>;\n  }\n}\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("hole-not-allowed");
    expect(report.findings[0].line).toBe(4);
  });

  /**
   * A project using this syntax cannot run plain `tsc` — the compiler refuses the file at the parse
   * step — so this IS its `tsc`. A report that dropped ordinary type errors would look like a
   * passing check on a program nothing checked.
   */
  test("an ordinary type error in a file with a block is reported too", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = <div className={@@( display: flex; )}>x</div>;\nexport default [n, a];\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(1);
    expect(report.findings[0].code).toBe(2322);
  });

  test("and one in a file with no block at all", () => {
    const report = check({
      "Card.tsx": `const a = <div className={@@( display: flex; )}>x</div>;\nexport default a;\n`,
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
      "Card.tsx": `const a = (\n  <div className={@@(\n    dsiplay: flex;\n    position: statik;\n    &:hover {\n      colr: red;\n    }\n  )}>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings.map((f) => f.line)).toEqual([3, 4, 6]);
    expect(report.findings[0].message).toContain("Did you mean `display`?");
    expect(report.findings[1].message).toContain(`Did you mean '"static"'?`);
    expect(report.findings[2].message).toContain("Did you mean `color`?");
  });

  test("two files each report their own", () => {
    const report = check({
      "One.tsx": `const a = <div className={@@( dsiplay: flex; )}>x</div>;\nexport default a;\n`,
      "Two.tsx": `const b = <div className={@@( positon: absolute; )}>x</div>;\nexport default b;\n`,
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
      "Card.tsx": `const a = (\n  <div className={@@(\n    display: flexx;\n  )}>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-value");
    expect(report.findings[0].line).toBe(3);
    expect(report.findings[0].message).toContain("Did you mean `flex`?");
  });

  test("both kinds arrive in the order a person reads the file", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = (\n  <div className={@@(\n    display: flexx;\n  )}>x</div>\n);\nexport default [n, a];\n`,
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
      "Card.tsx": `const a = (\n  <div className={@@(\n    flex-dirction: row;\n  )}>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-property");
    expect(report.findings[0].message).toContain("flex-direction");
  });

  /**
   * **AND IT ONLY LOOKED AT ONE RULE**, so a `//` comment came back twice.
   *
   * The filter above asks whether an `unknown-property` finding sits at that character. Every other
   * rule that speaks where TypeScript also refuses the key left the author with two errors for one
   * mistake — and the compiler's is the worse one. Measured:
   *
   *     line-comment: CSS has no `//` comment — … Write a block comment instead.
   *     TS2353: … and '"// the palette is in flux\n  gap"' does not exist in type 'CssBlockShape'.
   *
   * The second quotes the comment and the NEXT property mashed together as a key, with the newline
   * spelt out. It is unactionable beside a message that says exactly what to do.
   *
   * The principle in the note above was already right — *"the same fault at the same character is
   * the same fault"* — and only the filter was narrow. Swept across twelve faults, this is the one
   * that doubled, which is why it is a widening of the same rule rather than a case for `//`.
   */
  test("a line comment is reported once, by the rule that explains it", () => {
    const report = check({
      "Card.tsx": `const a = @@(\n  color: red;\n  // the palette is in flux\n  gap: 8px;\n);\nexport default a;\n`,
    });

    expect(report.findings.map((finding) => finding.code)).toEqual(["line-comment"]);
  });

  /**
   * A descriptor that is not one — named ONCE, by us.
   *
   * It used to be the compiler's alone: `DESCRIPTORS` was a near-miss search, and `nope` is near
   * nothing, so no rule claimed it. Since review pass 6 `unknown-property` reports a name CSS does
   * not have whether or not it has a suggestion, because the BUILD runs no TypeScript and a typo
   * compiled — so the rule speaks and `inOrder` drops the compiler's `TS2353` on the line.
   *
   * What the count is protecting is unchanged: one fault, one report.
   */
  test("a descriptor that is not one is reported once, by the rule", () => {
    const report = check({
      "Face.tsx": `const f = @@font-face(\n  src: url(a.woff2);\n  nope: 1;\n);\nexport default f;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-property");
    expect(report.findings[0].message).toContain("font-face");
    expect(report.findings[0].line).toBe(3);
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
      "Card.tsx": `const n: number = "no";\nconst a = <div className={@@(\n  $(name): 24px;\n)}>x</div>;\nexport default [n, a];\n`,
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
    // CORRECT css, so the only finding can be the setup fault. It used to hold `dsiplay`, which the
    // types alone reported; since pass 6 the RULE reports a plain property name too — so the block
    // would carry a fault of its own and the count would stop being about the setup.
    const report = checkProject(
      project({ "Card.tsx": `const a = <div className={@@( display: flex; )}>x</div>;\nexport default a;\n` }, null),
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
        { "Card.tsx": `const a = <div className={@@( display: flex; )}>x</div>;\nexport default a;\n` },
        join(root, "empty.ts"),
      ),
    );

    // Six, because the virtual file names six things from that module — the block's shape, what a
    // block IS, composition's two, what a hole in a value must be, and `CssGlobal`, the keywords a
    // narrowed value also takes (§13). Each missing one is its own setup fault, and each is reported.
    //
    // It was six once before, and `$` was the sixth. The fallback is written inline now rather than
    // imported, so that no module has to export a `$` — an export is an auto-import suggestion, and
    // a user met `import { $ } from "@ramonda/css/properties"` offered beside their own generated one.
    expect(report.findings).toHaveLength(6);
    expect(report.findings.map((one) => one.message).join(" ")).toContain("CssBlockShape");
  });

  test("and it is reported once, whatever the project's size", () => {
    const files: Record<string, string> = {};
    for (let n = 0; n < 4; n++)
      files[`C${n}.tsx`] = `const a${n} = <div className={@@( display: flex; )}>x</div>;\nexport default a${n};\n`;

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

  /**
   * What the BINDING is worth, which is the other half of registering a property.
   *
   * A registered property's name is generated, so it already works as a key; what it could not do
   * until now is carry the kind its own `syntax` declared. `never` — what every named site returned
   * — is assignable to everything, so a wrong setter passed and nothing said so. The assertion is a
   * FAULT rather than a silence, because a silence is also what a broken surface gives.
   */
  test("its binding carries the kind its syntax declared", () => {
    const report = check({
      "Angle.tsx":
        `import type { CssVar } from "@ramonda/css/properties";
` +
        `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `export const ok: CssVar<"angle"> = angle;
`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and a setter of another kind is refused on the line that wrote it", () => {
    const report = check({
      "Angle.tsx":
        `import type { CssVar } from "@ramonda/css/properties";
` +
        `const angle = @@property(
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
);
` +
        `export const bad: CssVar<"length"> = angle;
`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(7);
  });

  /** `"*"` declares no kind, so its name takes what CSS itself would — and refuses nothing. */
  test("a property whose syntax is `*` binds a name of no particular kind", () => {
    const report = check({
      "Any.tsx":
        `import type { CssVar } from "@ramonda/css/properties";
` +
        `const any = @@property(
  syntax: "*";
  inherits: false;
);
` +
        `export const ok: CssVar<"any"> = any;
`,
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
 * reports a fault the build does not have — `$(angle): 45deg` is a hole in a property name, which
 * is refused everywhere except here.
 */
describe("a reference to a named site", () => {
  test("reading one in a value is not a fault", () => {
    const report = check({
      "Card.tsx": `const slide = @@keyframes(\n  from { opacity: 0; }\n);\nconst card = @@( animation: $(slide) 3s; );\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and setting a registered property by name is not either", () => {
    const report = check({
      "Card.tsx": `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\nconst card = @@( $(angle): 45deg; );\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("while a hole in a name that stands for nothing is still reported", () => {
    const report = check({
      "Card.tsx": `const card = @@( $(whatever): 45deg; );\nexport { card };\n`,
    });

    expect(report.findings.length).toBeGreaterThan(0);
  });

  /**
   * ONE DECLARED IN ANOTHER MODULE, which is the shape a shared theme has and the shape this refused.
   *
   * The reference reader is injected — `Imported.read` — and its own note says why: "a virtual file
   * that resolved less than the build would type-check an expression the build never emits, and
   * report a name the author was right to write." Both halves of this command are in that note, and
   * only one of them obeyed it. `checkedSource` was given the reader; `virtualFile` was not, so the
   * type half resolved less than the build.
   *
   * Measured through the real command, on a file that compiles: *1 block(s) could not be read, so
   * nothing was checked*, and a message that says the name must be "declared in this file" — which it
   * is, in the file next to it. A project with a shared token could not run the check at all.
   */
  const THEME = `export const accent = @@property(\n  syntax: "<color>";\n  inherits: false;\n  initial-value: #10b981;\n);\n`;

  test("one imported from another module reads in a value", () => {
    const report = check({
      "theme.ts": THEME,
      // The setter is here because a property read and set by nothing is its own finding now — see
      // `registered-never-set`. What this test is about is the READ resolving across the module.
      "Card.tsx":
        `import { accent } from "./theme";\nconst card = @@( color: var($(accent)); );\n` +
        `export const tint = (value: string) => ({ [accent]: value });\nexport { card };\n`,
    });

    expect(report.refused).toBe(false);
    expect(report.findings).toEqual([]);
  });

  test("and sets a registered property by name, which only resolving makes legal", () => {
    const report = check({
      "theme.ts": THEME,
      "Card.tsx": `import { accent } from "./theme";\nconst card = @@( $(accent): #f05; );\nexport { card };\n`,
    });

    expect(report.refused).toBe(false);
    expect(report.findings).toEqual([]);
  });

  /**
   * A property every block READS and nothing SETS, which with the hole gone is the mistake this
   * door makes possible — see `registeredNeverSet`.
   */
  test("one read by a block and set by nothing is reported on its own declaration", () => {
    const report = check({
      "Card.tsx":
        `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `const card = @@( transform: rotate(var($(angle))); );\nexport { card };\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("registered-never-set");
    expect(report.findings[0].line).toBe(1);
    expect(report.findings[0].message).toContain("`angle`");
  });

  test("a block setting it is a set, so nothing is reported", () => {
    const report = check({
      "Card.tsx":
        `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `const card = @@( $(angle): 45deg; transform: rotate(var($(angle))); );\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * ANY reference in TypeScript is a set, and the bar is that low on purpose: the binding is a
   * string, so it reaches a setter through any expression a person can write, and a narrower test
   * would be a false report on working code.
   */
  test("a reference anywhere in the program is a set, wherever it was written", () => {
    const report = check({
      "theme.ts": `export const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n`,
      "Card.tsx":
        `import { angle } from "./theme";\n` +
        `const card = @@( transform: rotate(var($(angle))); );\n` +
        `export const at = (deg: string) => ({ [angle]: deg });\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and one read across modules with no reference at all is still reported, on the module that declares it", () => {
    const report = check({
      "theme.ts": `export const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n`,
      "Card.tsx": `import { angle } from "./theme";\nconst card = @@( transform: rotate(var($(angle))); );\nexport { card };\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("registered-never-set");
    expect(report.findings[0].file).toContain("theme.ts");
  });

  /**
   * **Both escapes, asserted rather than claimed.** This rule is an error like every other and is
   * wrong about one real shape — a library exporting a property for its consumers to set — so a
   * project that meets that shape needs a way out that works.
   */
  test("a directive on the line above the declaration silences it", () => {
    const report = check({
      "Card.tsx":
        `// ramonda-css-ignore a consumer of this package sets it\n` +
        `export const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `const card = @@( transform: rotate(var($(angle))); );\nexport { card };\n`,
    });

    expect(report.findings).toEqual([]);
    expect(report.exempted).toHaveLength(1);
  });

  test("and so does turning the rule off in the config", () => {
    const report = check({
      "Card.tsx":
        `export const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `const card = @@( transform: rotate(var($(angle))); );\nexport { card };\n`,
      "ramonda.css.ts": `export default { rules: { "registered-never-set": "off" } };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * **ANY reference in TypeScript is a set, and the bar is that low on purpose.**
   *
   * The binding is a string, so it reaches a setter through any expression a person can write.
   * Narrowing to `style={{ [name]: … }}` or to `toStyle` would have to follow all of them, and the
   * one it missed would be a false report on working code — which is the failure a checker does not
   * survive. Swept here rather than argued: seven shapes, all quiet.
   */
  test.each([
    ["set through `style`", `export const at = (v: string) => ({ [angle]: v });\n`],
    [
      "handed to a helper",
      `declare function spin(n: string, d: number): void;\nexport const go = () => spin(angle, 45);\n`,
    ],
    ["kept in a class field", `export class C { name = angle; }\n`],
    ["put in an array", `export const all = [angle];\n`],
    ["put in a nested object", `export const m = { a: { b: angle } };\n`],
  ])("a property %s is not reported", (_what, extra) => {
    const report = check({
      "Card.tsx":
        `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `const card = @@( transform: rotate(var($(angle))); );\nexport { card };\n` +
        extra,
    });

    expect(report.findings.map((one) => one.code)).not.toContain("registered-never-set");
  });

  /**
   * And a RE-EXPORT is the documented false report rather than a new one: naming a property on its
   * way out is how a library hands one to consumers this program cannot see, and it is the same
   * shape as a theme module that declares and exports one. Pinned so the answer is a decision rather
   * than an accident; both escapes are asserted above.
   */
  test("a re-export is still reported, which is the one shape this rule is wrong about", () => {
    const report = check({
      "theme.ts": `export const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n`,
      "Card.tsx":
        `import { angle } from "./theme";\n` +
        `const card = @@( transform: rotate(var($(angle))); );\nexport { card, angle };\n`,
    });

    expect(report.findings.map((one) => one.code)).toContain("registered-never-set");
  });

  /** Read by nothing is not this rule's business — it says the value never ARRIVES, not that it is unused. */
  test("one nothing reads is not reported, because nothing is waiting for a value", () => {
    const report = check({
      "Card.tsx": `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\nexport { angle };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** And a name no module exports is still a hole, so the fault it really is comes back. */
  test("a name the imported module does not export is still reported", () => {
    const report = check({
      "theme.ts": THEME,
      "Card.tsx": `import { missing } from "./theme";\nconst card = @@( $(missing): #f05; );\nexport { card };\n`,
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
      "Card.tsx": `// @ts-nocheck\nconst n: number = "no";\nconst a = <div className={@@( display: flex; )}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and it does not switch off a file that never asked", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = <div className={@@( display: flex; )}>x</div>;\nexport default a;\n`,
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
      "Card.tsx": `/// <reference path="../outside/globals.d.ts" />\nconst a = <div className={@@( display: flex; )}>{PLANTED}</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a licence header above a block does not move anything", () => {
    const report = check({
      "Card.tsx": `/*\n * Copyright somebody.\n */\nconst a = <div className={@@(\n  dsiplay: flex;\n)}>x</div>;\nexport default a;\n`,
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
 * a typo inside `when` is the same `TS2561` it is outside one.
 */
describe("a conditional group", () => {
  test("an ordinary condition is not a fault", () => {
    const report = check({
      "Card.tsx": `class C {\n  off = false;\n  r() {\n    return <div className={@@( cursor: pointer; when $(this.off) { cursor: not-allowed; } )}>x</div>;\n  }\n}\nexport default C;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and so is one that may be missing, which is the shape a prop has", () => {
    const report = check({
      "Card.tsx": `declare const maybe: { a: 1 } | undefined;\nconst a = <div className={@@( when $(maybe) { opacity: 0.5; } )}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** A condition that can never be false is a group that can never be off. */
  test.each([
    [
      "a method that was not called",
      `class C { off() {} r() { return <div className={@@( when $(this.off) { opacity: 0.5; } )}>x</div>; } }`,
    ],
    ["an object", `declare const o: { a: 1 };\nconst a = <div className={@@( when $(o) { opacity: 0.5; } )}>x</div>;`],
    [
      "a promise",
      `declare const p: Promise<number>;\nconst a = <div className={@@( when $(p) { opacity: 0.5; } )}>x</div>;`,
    ],
    // **Measured and MISSED before this line existed.** The check asked whether the type was an
    // object, and a literal is not one — so every one of these passed while never being false.
    [
      "a string literal",
      `declare const s: "yes";\nconst a = <div className={@@( when $(s) { opacity: 0.5; } )}>x</div>;`,
    ],
    [
      "a union of them",
      `declare const s: "a" | "b";\nconst a = <div className={@@( when $(s) { opacity: 0.5; } )}>x</div>;`,
    ],
    [
      "a union of numbers",
      `declare const n: 1 | 2;\nconst a = <div className={@@( when $(n) { opacity: 0.5; } )}>x</div>;`,
    ],
    [
      "a template type that cannot be empty",
      `declare const t: \`x\${string}\`;\nconst a = <div className={@@( when $(t) { opacity: 0.5; } )}>x</div>;`,
    ],
    [
      "an array, which is an object wearing a length",
      `declare const xs: number[];\nconst a = <div className={@@( when $(xs) { opacity: 0.5; } )}>x</div>;`,
    ],
  ])("%s is reported, because it is always truthy", (_what, code) => {
    const report = check({ "Card.tsx": `${code}\nexport {};\n` });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toMatch(/always truthy/);
  });

  /**
   * What must stay allowed, because truthiness is the QUESTION rather than an accident.
   *
   * `when` is a `when`, and a condition that can be false is a condition. Requiring `boolean` would
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
      "Card.tsx": `${declare}\nconst a = <div className={@@( when $(${expression}) { opacity: 0.5; } )}>x</div>;\nexport {};\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a typo inside a group is the same fault it is outside one", () => {
    const report = check({
      "Card.tsx": `declare const c: boolean;\nconst a = <div className={@@(\n  when $(c) {\n    dsiplay: flex;\n  }\n)}>x</div>;\nexport default a;\n`,
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
      "Card.tsx": `declare const o: { a: 1 };\nconst a = <div className={@@(\n  when $(o) {\n    dsiplay: flex;\n    colr: red;\n  }\n)}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(3);
    expect(report.findings.map((one) => one.line)).toEqual([3, 4, 5]);
  });
});

describe("a spread", () => {
  test("of a block is not a fault", () => {
    const report = check({
      "Card.tsx": `const base = @@( display: flex; );\nconst a = <div className={@@( ...$(base); opacity: 0.5; )}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("of something that is not a block is reported", () => {
    const report = check({
      "Card.tsx": `declare const plain: { color: string };\nconst a = <div className={@@( ...$(plain); )}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toMatch(/style block/);
  });

  test("and the fault lands on the expression the author wrote", () => {
    const report = check({
      "Card.tsx": `declare const plain: string;\nconst a = <div className={@@(\n  display: flex;\n  ...$(plain);\n)}>x</div>;\nexport default a;\n`,
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
 *   `color: $(maybe)` passed — for the 424 properties whose type is `CssValue`. The 127 closed ones
 *   caught it by accident, because they refuse a bare `string` too.
 * - A value that is TEXT AND HOLES is written as a template literal, which accepts anything at all.
 *   Nothing here was checked: not `undefined`, not `null`, not an object, not a function's `void`.
 *
 * The user asked for this in as many words: a hole may not be nullable, so a fallback has to be
 * written. `exactOptionalPropertyTypes` was measured first and refused — it also reports the
 * author's own ordinary code, which would be a false report under their own settings.
 */
/**
 * A RUNTIME VALUE IN A DECLARATION, WHICH NOTHING TAKES ANY MORE.
 *
 * This used to be a long section about what a hole may evaluate to — `undefined` refused, a number
 * accepted, a colour the author typed as one accepted. All of it went with the hole. What is left
 * is the one answer, given once wherever the hole is written, with both replacements named.
 *
 * **The compiler's own word about the expression is dropped**, which is the half that had to be
 * built: `__val` still constrains a hole to `CssValue`, so a bad one produced `TS2345` beside the
 * rule. An author who acted on that message would have typed the expression correctly and still
 * had the finding. See `inOrder`.
 */
describe("a runtime value in a declaration", () => {
  const held = (declaration: string, head = "") =>
    check({ "Card.tsx": `${head}const a = <div className={@@(\n  ${declaration}\n)}>x</div>;\nexport default a;\n` });

  test.each([
    ["a whole value", "  color: $(brand);", "declare const brand: string;\n"],
    ["part of one", "  border-left: $(w) solid red;", "declare const w: string;\n"],
    ["a custom property's value", "  --brand: $(brand);", "declare const brand: string;\n"],
    ["one inside a nested rule", "  &:hover { color: $(brand); }", "declare const brand: string;\n"],
  ])("%s is reported, once, on the hole the author wrote", (_what, declaration, head) => {
    const report = held(declaration, head);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("hole-not-allowed");
    expect(report.findings[0].line).toBe(3);
  });

  /**
   * **One finding, not two.** Both of these are also a type error — `undefined` and an object are
   * not `CssValue` — and the compiler reports each on the same expression. The rule speaks and the
   * type is dropped, because the fix is to delete the hole either way.
   */
  test.each([
    ["undefined", "  color: $(maybe);", "declare const maybe: string | undefined;\n"],
    ["an object", "  color: $(obj);", "declare const obj: { a: number };\n"],
  ])("%s is one finding, ours, and not the compiler's as well", (_what, declaration, head) => {
    const report = held(declaration, head);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("hole-not-allowed");
  });

  /** The message sends a person to both doors, because which one applies is theirs to know. */
  test("the message names `match` and `@@property`", () => {
    const [only] = held("  color: $(brand);", "declare const brand: string;\n").findings;

    expect(only.message).toContain("match");
    expect(only.message).toContain("@@property");
  });

  /**
   * What is NOT a runtime value, though it has braces. Each of these chooses between whole rules or
   * names something the compiler resolves to text, and none puts a value on an element.
   */
  test("a hole in a condition is still any expression at all", () => {
    expect(held("  when $(on) { color: red; }", "declare const on: boolean;\n").findings).toEqual([]);
  });

  test("a match chooses between classes, so it is not one", () => {
    const report = held(
      "  color: match $(tone) {\n    hot => red;\n    _ => blue;\n  };",
      'declare const tone: "hot" | "cold";\n',
    );

    expect(report.findings).toEqual([]);
  });

  test("and a registered property, read and set by name", () => {
    const report = check({
      "Card.tsx":
        `const angle = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `const a = <div className={@@( $(angle): 45deg; transform: rotate(var($(angle))); )}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
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
      "const base = @@( color: red; );\nconst a = <div className={@@(\n  &:hover { ...$(base); }\n)}>x</div>;\nexport default a;\n",
      "spread-out-of-place",
    ],
    [
      "a spread inside a `@media`",
      "const base = @@( color: red; );\nconst a = <div className={@@(\n  @media print { ...$(base); }\n)}>x</div>;\nexport default a;\n",
      "spread-out-of-place",
    ],
    [
      "a hole inside `@@keyframes`",
      "declare const w: number;\nconst k = @@keyframes(\n  from { opacity: $(w); }\n);\nexport default k;\n",
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
    ["a spread at the top level", "  ...$(base);"],
    ["a spread inside `if`, which changes no key", "  when $(on) { ...$(base); }"],
  ])("%s is accepted here, as the build accepts it", (_what, body) => {
    const report = check({
      "Card.tsx":
        `const base = @@( color: red; );\ndeclare const on: boolean;\ndeclare const w: number;\n` +
        `const a = <div className={@@(\n${body}\n)}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * A `@@name( … )` whose name is not one this compiles, and a named block holding composition.
   *
   * Both were refused by the build and by nothing else, and both came back as SOMETHING ELSE. A
   * misspelt name had no surface, so the ordinary block check took over and reported `from { … }` as
   * a nested rule; and `when` inside `@@keyframes` was reported as *`if ( 0 )` is not a keyframe*.
   * A wrong message is worse than none — it sends a person to the wrong line.
   */
  test.each([
    [
      "a misspelt at-name",
      "const k = @@keyfrmes(\n  from { opacity: 0; }\n);\nexport default k;\n",
      "unknown-named-block",
      "Did you mean `@@keyframes( … )`?",
    ],
    [
      "`if` inside a named block",
      "declare const on: boolean;\nconst k = @@keyframes(\n  when $(on) { from { opacity: 0; } }\n);\nexport default k;\n",
      "composition-in-a-named-block",
      "cannot hold `when`",
    ],
    [
      "a spread inside a named block",
      'declare const base: never;\nconst f = @@font-face(\n  font-family: "Brand";\n  src: url("/b.woff2");\n  ...$(base);\n);\nexport default f;\n',
      "composition-in-a-named-block",
      "cannot hold a spread",
    ],
  ])("%s is reported once, and about itself", (_what, source, rule, says) => {
    const report = check({ "Card.tsx": source });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe(rule);
    expect(report.findings[0].message).toContain(says);
  });

  /** And a typo inside a bare selector is still the typo it was — the key changed, not the check. */
  test("a property typo inside a bare selector is still caught", () => {
    const report = check({
      "Card.tsx": `const a = <div className={@@(\n  div { colr: red; }\n)}>x</div>;\nexport default a;\n`,
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
      "Card.tsx": `const a = <div className={@@(\n  color: var(--brand);\n)}>x</div>;\nexport default a;\n`,
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
      "Theme.tsx": `const t = <div className={@@(\n  --brand: #10b981;\n)}>x</div>;\nexport default t;\n`,
      "Card.tsx": `const a = <div className={@@(\n  color: var(--brand);\n)}>x</div>;\nexport default a;\n`,
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
            `const a = <div className={@@(\n  color: var($(brand));\n)}>x</div>;\nexport default [brand, a];\n`
          : `const a = <div className={@@(\n${body}\n)}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** The suggestion comes from every name in the project now, not from the one block's own. */
  test("a near miss in another file is offered", () => {
    const report = check({
      "Theme.tsx": `const t = <div className={@@(\n  --accent: #10b981;\n)}>x</div>;\nexport default t;\n`,
      "Card.tsx": `const a = <div className={@@(\n  color: var(--ackcent);\n)}>x</div>;\nexport default a;\n`,
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
      "Card.tsx": `const panel = @@( display: flex; );\nconst a = <div className={panel}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a hand-written object with the same fields is not one", () => {
    const report = check({
      "Card.tsx":
        `const forged = { className: "r-x", properties: [], values: [] };\n` +
        `const a = <div className={@@( ...$(forged); )}>x</div>;\nexport default a;\n`,
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
  const SOURCE = `const a = <div className={@@(\n  padding: 1em;\n)}>x</div>;\nexport default a;\n`;

  test("each package's own, inside one project", () => {
    const report = check({
      "web/ramonda.css.ts": `export default { units: { length: ["px"] } };\n`,
      "web/Card.tsx": SOURCE,
      "admin/ramonda.css.ts": `export default { units: { length: ["px", "em"] } };\n`,
      "admin/Card.tsx": SOURCE,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].file).toMatch(/web[/\\]Card\.tsx$/);
    expect(report.findings[0].message).toContain("px");
  });

  /** And the shared one above them still governs a package that has none of its own. */
  test("the root's config, for a package that does not have one", () => {
    const report = check({
      "ramonda.css.ts": `export default { units: { length: ["px"] } };\n`,
      "web/Card.tsx": SOURCE,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("px");
  });
});

/**
 * A block the parser gave up on, and a file that read perfectly beside it.
 *
 * The refusal stops the TYPE check — there is no virtual file for the module it failed in, so the
 * compiler's word about anything is the confusion of a file it could not read. That reason does not
 * reach a DIFFERENT file whose block parsed: the CSS rules ran over it and what they found is as
 * true as it ever was.
 *
 * Measured before this was fixed: one unreadable block hid every other file's findings, so a typo
 * anywhere meant fixing a repository one error per run.
 */
describe("a refusal, and the files that read anyway", () => {
  const files = {
    "Card.tsx": "export const first = @@(\n  content: url(;\n);\n",
    "Other.tsx": "export const third = @@(\n  colour: red;\n);\n",
  };

  test("the refusal is reported on its own line", () => {
    const report = check(files);

    expect(report.refused).toBe(true);
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0].file).toContain("Card.tsx");
  });

  test("and the other file's fault is reported too", () => {
    const said = check(files).findings.filter((one) => one.file.includes("Other.tsx"));

    expect(said).toHaveLength(1);
    expect(said[0].code).toBe("unknown-property");
  });

  /** The compiler's own word stays out, which is what the refusal is about. */
  test("while no TypeScript diagnostic is reported at all", () => {
    expect(check(files).findings.filter((one) => typeof one.code === "number" && one.code !== 0)).toEqual([]);
  });
});

/**
 * A block a PROP can constrain — the `css` shape.
 *
 * The allow-list is an ordinary block shape used as a TYPE, so a slot is written in the vocabulary
 * a block is written in and nothing new has to be learnt. What is asserted here is not that the
 * types are clever but that the fault lands where the author can act on it: on the value, on the
 * property name, or inside the state — never on the call.
 *
 * **The last test is the one that guards everybody else.** A block in no slot at all must keep
 * taking every property there is; a slot that narrowed ordinary blocks would be a regression
 * affecting every file in every project.
 */
/**
 * **A block in a `${ … }`, which produces no site — so nothing downstream of one can see it.**
 *
 * `transform` learned this and says so where it refuses: *asked before the early return, since a
 * file whose only block is in a template finds no site at all*. `checkProject` asks AFTER — the
 * whole CSS pass sits behind `if (virtual !== undefined)` — so the rule never ran and the file went
 * to `tsc` as written. Measured, what a person got from `ramonda-css`:
 *
 *     TS1005: ')' expected.
 *     TS1003: Identifier expected.
 *     TS2322: Type '{ className: string; red: true; }' is not assignable …
 *
 * Six of them, naming neither the block nor the line — which is the sentence `block-in-a-template`
 * exists to replace, quoted from its own docstring.
 */
describe("a block inside a template literal, through the project checker", () => {
  const IN_A_TEMPLATE = "const a = <div className={`x ${@@( color: red; )}`}>y</div>;\nexport default a;\n";

  test("is reported by its own rule", () => {
    const report = check({ "Card.tsx": IN_A_TEMPLATE });

    expect(report.findings.map((one) => String(one.code))).toContain("block-in-a-template");
  });

  /**
   * And the compiler's word about the same file goes with it. The file cannot be parsed until the
   * block moves, so every syntax error in it is about the one fault already named — the same trade
   * `inOrder` makes everywhere else.
   */
  test("and the compiler's syntax errors about that file are not piled on top", () => {
    const report = check({ "Card.tsx": IN_A_TEMPLATE });
    const numbers = report.findings.filter((one) => typeof one.code === "number").map((one) => one.code);

    expect(numbers).toEqual([]);
  });
});

describe("a block a prop can constrain", () => {
  /** A component whose `css` takes a colour from the theme, one of two gaps, and a hover colour. */
  const CARD =
    `import type { CssBlock } from "@ramonda/css/properties";\n` +
    `export type CardStyle = {\n` +
    `  color?: string;\n` +
    `  gap?: "8px" | "16px";\n` +
    `  "&:hover"?: { color?: string }[];\n` +
    `};\n` +
    `export function Card(props: { css?: CssBlock<CardStyle> }) { return <div className={props.css}>x</div>; }\n`;

  const calling = (block: string) => ({
    "Card.tsx": CARD,
    "Use.tsx": `import { Card } from "./Card";\nconst a = <Card css={@@( ${block} )} />;\nexport default a;\n`,
  });

  test("a block the slot allows is quiet", () => {
    expect(check(calling(`color: red; gap: 8px;`)).findings).toEqual([]);
  });

  test("a state the slot allows is quiet too", () => {
    expect(check(calling(`&:hover { color: blue; }`)).findings).toEqual([]);
  });

  test("a property the slot does not allow is reported, and named", () => {
    const report = check(calling(`padding: 4px;`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("padding");
    expect(report.findings[0].file).toContain("Use.tsx");
  });

  test("a value the slot narrows is reported", () => {
    const report = check(calling(`gap: 20px;`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("20px");
  });

  /**
   * The CSS-wide keywords pass a narrowed value, as `Keyword<K>` lets them pass a closed list.
   * They are what CSS itself provides, not a value the project chose — DESIGN.md §13, decided by the
   * user. Everything else the slot refuses still is: another value, and `!important`.
   */
  test.each(["inherit", "initial", "unset", "revert", "revert-layer"])("a narrowed value takes `%s`", (word) => {
    expect(check(calling(`gap: ${word};`)).findings).toEqual([]);
  });

  test("and so does a narrowed value inside a state", () => {
    const report = check({
      "Card.tsx": CARD.replace(`"&:hover"?: { color?: string }[];`, `"&:hover"?: { gap?: "8px" }[];`),
      "Use.tsx": `import { Card } from "./Card";\nconst a = <Card css={@@( &:hover { gap: inherit; } )} />;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * `any` in an allow-list is left as it is. The widening asked whether a value is an array — a
   * state — and `any` answers yes to that, so `width?: any` became an array and `width: 10px` a
   * false error. A review of §13 found it.
   */
  test("a value typed `any` still takes anything", () => {
    const report = check({
      "Card.tsx": CARD.replace(`gap?: "8px" | "16px";`, `gap?: "8px" | "16px";\n  width?: any;`),
      "Use.tsx": `import { Card } from "./Card";\nconst a = <Card css={@@( width: 10px; )} />;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and a state inside a state, which is where `@media` holding a `&:hover` puts it", () => {
    const report = check({
      "Card.tsx": CARD.replace(
        `"&:hover"?: { color?: string }[];`,
        `"@media (width > 1px)"?: { "&:hover"?: { gap?: "8px" }[] }[];`,
      ),
      "Use.tsx": `import { Card } from "./Card";\nconst a = <Card css={@@( @media (width > 1px) { &:hover { gap: inherit; } } )} />;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * A file with no `import` or `export` is a SCRIPT, and what the virtual file declares in it is
   * global — so two of them declaring one name is `TS2300`. A named type for the widening did that,
   * and `declare const` for `$` did it before §13. A review of §13 found both.
   */
  test("two script files, each with a block, do not collide", () => {
    const report = check({
      "A.tsx": `const a = <div className={@@( color: red; )}>x</div>;\n`,
      "B.tsx": `const b = <div className={@@( color: blue; )}>y</div>;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("a keyword does not open the slot to anything else", () => {
    expect(check(calling(`gap: inherit !important;`)).findings).toHaveLength(1);
    expect(check(calling(`padding: inherit;`)).findings).toHaveLength(1);
  });

  test("a property is reported INSIDE a state, not on the state", () => {
    const report = check(calling(`&:hover { padding: 4px; }`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("padding");
  });

  /**
   * **Every declaration in a state, not only the first** — which is what the nested type being an
   * ARRAY buys, and what a one-element TUPLE silently does not.
   *
   * `[{ … }]` was the spelling shipped first, and it gives a contextual type to element 0 alone:
   * the emitted `"&:hover":[{color},{padding},{margin}]` had its first declaration checked and the
   * rest accepted whatever they set. Measured on the playground's own `Chip` — the same
   * `float: left` was reported as the first declaration in a `&:hover` and silent as the second.
   *
   * The test above could not see it, because a single declaration is always element 0.
   */
  test("and so is one written after a declaration the slot allows", () => {
    const report = check(calling(`&:hover { color: blue; padding: 4px; }`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("padding");
  });

  test("every property a state sets outside the list is reported, not just one", () => {
    const report = check(calling(`&:hover { color: blue; padding: 4px; margin: 2px; float: left; }`));

    expect(report.findings.map((one) => one.message).join(" ")).toContain("padding");
    expect(report.findings.map((one) => one.message).join(" ")).toContain("margin");
    expect(report.findings.map((one) => one.message).join(" ")).toContain("float");
  });

  test("a state the slot does not allow is reported", () => {
    const report = check(calling(`&:focus { color: blue; }`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("focus");
  });

  /** No list of forbidden selectors: a combinator is refused because it is not a key. */
  test("a combinator is refused with no rule of its own", () => {
    const report = check(calling(`& > span { color: blue; }`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("span");
  });

  test("an ordinary block, in no slot, still takes every property", () => {
    const report = check({
      "Card.tsx":
        `const panel = @@( padding: 4px; display: flex; color: red; & > span { gap: 20px; } );\n` +
        `const a = <div className={panel}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * **The control above asserts SILENCE, and silence is also what a broken check gives** — measured
   * the hard way: an unresolvable constraint turned every block into `any` and sixteen tests went
   * quiet at once while this one still passed. So the control that guards ordinary blocks has to
   * assert a FAULT, not the absence of one.
   */
  test("and an ordinary block's own faults are still reported", () => {
    const report = check({
      "Card.tsx": `const panel = @@( colr: red; );\nconst a = <div className={panel}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("color");
  });
});

/**
 * A state in an allow-list written as a one-element TUPLE.
 *
 * **The fault is silent, which is the only reason it needs a rule.** `[{ … }]` type-checks, the
 * slot keeps working for the first declaration in the state, and everything written under that one
 * is accepted whatever it sets. Measured on the playground's `Chip`: the same `float: left` was a
 * `TS2353` as the first declaration inside `&:hover` and silent as the second.
 *
 * The docs said `{ … }[]` in prose before this rule existed, and prose is what
 * `check:events` already had to be written because nobody reads.
 */
describe("a state written as a tuple", () => {
  const slot = (state: string) => ({
    "Card.tsx":
      `import type { CssBlock } from "@ramonda/css/properties";\n` +
      `export type CardStyle = {\n  color?: string;\n  ${state}\n};\n` +
      `export function Card(props: { css?: CssBlock<CardStyle> }) { return <div className={props.css}>x</div>; }\n`,
    "Use.tsx": `import { Card } from "./Card";\nconst a = <Card css={@@( color: red; )} />;\nexport default a;\n`,
  });

  test("is reported, on the state, with the spelling that works", () => {
    const report = check(slot(`"&:hover"?: [{ color?: string }];`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("state-is-a-tuple");
    expect(report.findings[0].file).toContain("Card.tsx");
    expect(report.findings[0].message).toContain("{ … }[]");
  });

  test("an at-rule state is reported the same way", () => {
    const report = check(slot(`"@media (min-width: 40rem)"?: [{ color?: string }];`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("state-is-a-tuple");
  });

  /** The spelling that works, which is what the message asks for. */
  test("an array is quiet", () => {
    expect(check(slot(`"&:hover"?: { color?: string }[];`)).findings).toEqual([]);
  });

  /**
   * **A tuple of more than one is not this fault** and must not be reported: every element then has
   * a contextual type, so the slot holds. It is a strange thing to write and it is not wrong.
   */
  test("a tuple of two is not reported", () => {
    expect(check(slot(`"&:hover"?: [{ color?: string }, { color?: string }];`)).findings).toEqual([]);
  });

  /** A tuple somewhere that is not a block shape at all — the rule must not reach it. */
  test("a tuple in an ordinary type is left alone", () => {
    const report = check({
      "Card.tsx":
        `export type Pair = { "&weird"?: [{ nothing?: string }] };\n` +
        `const panel = @@( color: red; );\nconst a = <div className={panel}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * **The KEY is what tells an allow-list from any other type, and the element cannot help.**
   *
   * Measured while reviewing this rule: of 34 ordinary field names tried — `x`, `y`, `content`,
   * `order`, `filter`, `all`, `width`, `color` — **all 34 are CSS property names**. So a test made
   * of the property list passes `{ x?: number; y?: number }`, and the first version of this rule
   * reported a JSON-LD `"@type"` and somebody's own `"&ref"` in files holding no block at all.
   *
   * A key is asked whether it is CSS instead: `&` has to continue as a selector does, and `@` has to
   * name an at-rule that may sit inside a rule.
   */
  const odd = (type: string) => ({
    "Odd.tsx": `export type Doc = ${type};\nconst a = <div className="x">y</div>;\nexport default a;\n`,
  });

  test("a JSON-LD `@type` holding a tuple is not an allow-list", () => {
    expect(check(odd(`{ "@type"?: [{ color?: string }] }`)).findings).toEqual([]);
  });

  test("an `&` key that is not a selector is not a state", () => {
    expect(check(odd(`{ "&ref"?: [{ x?: number; y?: number }] }`)).findings).toEqual([]);
  });

  test("an at-rule that cannot nest is not a state either", () => {
    expect(check(slot(`"@keyframes spin"?: [{ color?: string }];`)).findings).toEqual([]);
  });

  test.each([
    ["& .title"],
    ["&[data-on]"],
    ["& > span"],
    ["@media (min-width: 40rem)"],
    ["@supports (display: grid)"],
    ["@container (width > 20rem)"],
  ])("but %s is, and is reported", (key) => {
    const report = check(slot(`"${key}"?: [{ color?: string }];`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("state-is-a-tuple");
  });

  /**
   * **An allow-list must be a `type`, not an `interface`** — and that is not this rule's doing. An
   * interface gets no implicit index signature, so it is never assignable to `CssBlockShape` and
   * `CssBlock<Interface>` is a `TS2344` whatever is written inside it. Measured with the correct
   * array spelling and with no state at all: both are refused, and the type alias beside them is
   * clean. Asserted here so the limit is written down somewhere that runs.
   */
  test("an interface is refused as an allow-list, however it is spelled", () => {
    const iface = (state: string) =>
      check({
        "Card.tsx":
          `import type { CssBlock } from "@ramonda/css/properties";\n` +
          `export interface CardStyle { color?: string;${state} }\n` +
          `export function Card(props: { css?: CssBlock<CardStyle> }) { return <div className={props.css}>x</div>; }\n`,
      });

    expect(iface(` "&:hover"?: { color?: string }[];`).findings.map((one) => one.code)).toEqual([
      "allow-list-is-an-interface",
    ]);
    expect(iface("").findings.map((one) => one.code)).toEqual(["allow-list-is-an-interface"]);
  });
});

/**
 * An `interface` handed to `CssBlock` — the one refusal an author cannot act on.
 *
 * ## Why it needs a rule when the compiler already speaks
 *
 * Every other typed rule answers something TypeScript cannot ask, which is why `inOrder` lets the
 * two of them speak at one character. This one is the opposite: the compiler DOES report it, as
 * `TS2344`, and what it says is *Type 'CardStyle' is not assignable to type
 * `{ [nested: \`&${string}\`]: CssBlockShape[] }`*. That names an index signature the author never
 * wrote and never has to write, and it never says the word `interface`.
 *
 * The cause is TypeScript's own: an interface gets no implicit index signature, so it satisfies no
 * shape built out of one, whatever is inside it. Measured with the correct array spelling and with
 * no state at all — both refused, and the `type` beside them clean. There is nothing to fix inside
 * the interface, and an author reading `TS2344` would go looking there.
 *
 * So this rule REPLACES the compiler's word rather than joining it, which is the first time a typed
 * rule has had to.
 */
describe("an allow-list written as an interface", () => {
  const card = (shape: string) => ({
    "Card.tsx":
      `import type { CssBlock } from "@ramonda/css/properties";\n${shape}` +
      `export function Card(props: { css?: CssBlock<CardStyle> }) { return <div className={props.css}>x</div>; }\n`,
  });

  test("is reported, and says to use a type", () => {
    const report = check(card(`export interface CardStyle { color?: string }\n`));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("allow-list-is-an-interface");
    expect(report.findings[0].message).toContain("CardStyle");
    expect(report.findings[0].message).toContain("type");
  });

  /** The whole point: two messages for one fault is what this replaces. */
  test("and the compiler's TS2344 goes with it", () => {
    const report = check(card(`export interface CardStyle { color?: string }\n`));

    expect(report.findings.map((one) => one.code)).not.toContain(2344);
  });

  test("a type alias is clean", () => {
    expect(check(card(`export type CardStyle = { color?: string };\n`)).findings).toEqual([]);
  });

  /** An interface is an ordinary thing to write. Only one handed to `CssBlock` is this fault. */
  test("an interface nobody hands to CssBlock is left alone", () => {
    const report = check({
      "Card.tsx":
        `export interface Other { color?: string }\n` +
        `export type CardStyle = { color?: string };\n` +
        `const panel = @@( color: red; );\nconst a = <div className={panel}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

/**
 * The rules that need a `ts.Program`, which is what makes them different from every rule in
 * `rules.ts` — those read a parsed block and nothing else.
 *
 * Both answer a question a stylesheet cannot: what a caller was PROMISED. The promise is the prop's
 * type, so the promise and the block are readable at once, in one file, by one pass.
 */
describe("a style prop nobody uses", () => {
  const card = (body: string, prop = "CssBlock") =>
    check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: ${prop} }) {\n${body}\n}\n`,
      "Use.tsx": `import { Card } from "./Card";\nconst a = <Card />;\nexport default a;\n`,
    });

  test("a prop that takes a block and never reaches one is reported", () => {
    const report = card(`  return <div className={@@( color: red; )}>x</div>;`);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("style-prop-never-used");
    expect(report.findings[0].file).toContain("Card.tsx");
  });

  test("spread into a block, it is quiet", () => {
    expect(card(`  return <div className={@@( color: red; ...$(props.css); )}>x</div>;`).findings).toEqual([]);
  });

  /** The false report the FORWARD walk gave, which is why the pass runs backward from the spread. */
  test("reached through a local, it is quiet", () => {
    expect(card(`  const mine = props.css;\n  return <div className={@@( ...$(mine); )}>x</div>;`).findings).toEqual(
      [],
    );
  });

  test("handed on to another component's style prop, it is quiet", () => {
    const report = check({
      "Inner.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Inner(props: { titleCss?: CssBlock }) { return <div className={@@( ...$(props.titleCss); )}>x</div>; }\n`,
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\nimport { Inner } from "./Inner";\n` +
        `export function Card(props: { titleCss?: CssBlock }) { return <Inner titleCss={props.titleCss} />; }\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * Found by the OTHER tests, not by this one: seven of the allow-list tests above started failing
   * the moment this rule arrived, because a component with no styles of its own puts the prop
   * straight on the element and never spreads it. It has its own test now so it cannot regress
   * quietly.
   */
  test("put straight on an element, it is quiet", () => {
    expect(card(`  return <div className={props.css}>x</div>;`).findings).toEqual([]);
  });

  test("used for something that is not a style, it is still reported", () => {
    const report = card(`  console.log(props.css);\n  return <div className={@@( color: red; )}>x</div>;`);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("style-prop-never-used");
  });

  /**
   * A destructured prop is TWO declarations of one thing — the binding and the signature it came
   * from — and they are different symbols. Asking about one alone reported the other.
   */
  test("destructured, it is one subject and not two", () => {
    const used = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card({ css }: { css?: CssBlock }) { return <div className={@@( ...$(css); )}>x</div>; }\n`,
    });

    expect(used.findings).toEqual([]);
  });

  test("and destructured but unused, it is reported ONCE", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card({ css }: { css?: CssBlock }) { return <div className={@@( color: red; )}>x</div>; }\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("style-prop-never-used");
  });

  /**
   * Destructured in the BODY, so the signature comes first in source order and the binding second —
   * and it is the binding the block uses. Reported unless the group is read as a whole.
   */
  test("destructured in the body, where the first declaration is not the used one", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) {\n` +
        `  const { css } = props;\n` +
        `  return <div className={@@( ...$(css); )}>x</div>;\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * **The shape every real component in this repository has, and the one the fixtures did not.**
   *
   * Props arrive through a generic base class as `Readonly<P>`, and a homomorphic mapped type
   * synthesises a new symbol per property — so `this.props.css` and the `css` it was declared as
   * are two symbols for one thing. Measured on the real shape: identical symbol 0 times, shares a
   * declaration 1. Comparing symbols reported every style prop on every real component while every
   * fixture above passed, which is why this one is written the long way.
   */
  test("props reached through a generic base class are the same prop", () => {
    const base =
      `export type RenderableProps<P> = Readonly<P> & { readonly key?: string };\n` +
      `export declare class Component<P = {}> { props: RenderableProps<P>; }\n`;

    const used = check({
      "base.ts": base,
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\nimport { Component } from "./base";\n` +
        `export class Card extends Component<{ css?: CssBlock }> {\n` +
        `  render() { return <div className={@@( ...$(this.props.css); )}>x</div>; }\n}\n`,
    });

    expect(used.findings).toEqual([]);

    const unused = check({
      "base.ts": base,
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\nimport { Component } from "./base";\n` +
        `export class Card extends Component<{ css?: CssBlock }> {\n` +
        `  render() { return <div className={@@( color: red; )}>x</div>; }\n}\n`,
    });

    expect(unused.findings).toHaveLength(1);
    expect(unused.findings[0].code).toBe("style-prop-never-used");
  });

  /**
   * **Six shapes a real component takes, each in both directions.**
   *
   * Written as a probe over a scratch project first, and three of them were FALSE REPORTS: a
   * renamed destructure, a prop handed to an ordinary function, and one read through a getter. The
   * fixtures above all declare their props inline and hand them straight to a block, which is the
   * one shape that never fails.
   */
  test("a renamed destructure is a use", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) {\n` +
        `  const { css: mine } = props;\n` +
        `  return <div className={@@( ...$(mine); )}>x</div>;\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and when it is not used, the PROP is reported once — not the local as well", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) {\n` +
        `  const { css: mine } = props;\n` +
        `  return <div className={@@( color: red; )}>{String(mine)}</div>;\n}\n`,
    });

    expect(report.findings.map((one) => one.code)).toEqual(["style-prop-never-used"]);
  });

  /** Handed to a plain function, which asking the POSITION's kind instead of its type would miss. */
  test("passed to an ordinary function that takes a block is a use", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `function wrap(b: CssBlock | undefined) { return <div className={@@( ...$(b); )}>y</div>; }\n` +
        `export function Card(props: { css?: CssBlock }) { return wrap(props.css); }\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("read through a getter is a use", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export class Card {\n` +
        `  props!: { css?: CssBlock };\n` +
        `  get mine() { return this.props.css; }\n` +
        `  render() { return <div className={@@( ...$(this.mine); )}>x</div>; }\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /**
   * **A type of somebody else's that happens to be called `CssBlock`.**
   *
   * The extension carries this plugin and an editor opens it on every project there is, so a rule
   * that keys on a NAME reports in files that have never heard of this package. Measured on a
   * project declaring its own `type CssBlock = { className: string }` — it was reported.
   *
   * A compiled block is known by its BRAND, which is what a `unique symbol` is for: a look-alike
   * carries none, an import alias carries it, and a generated module re-exporting the real one
   * carries it too.
   */
  test("a type of the project's own, with the same name, is not a block", () => {
    const report = check({
      "Card.tsx":
        `type CssBlock = { className: string };\n` +
        `export function Card(props: { css?: CssBlock }) { return <div className="c">x</div>; }\n`,
      "Other.tsx": `const a = <div className={@@( color: red; )}>x</div>;\nexport default a;\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** The control that guards every other prop in every project: this rule speaks about blocks only. */
  test("a prop that is not a block is never mentioned", () => {
    const report = check({
      "Card.tsx": `export function Card(props: { title?: string }) { return <div className={@@( color: red; )}>x</div>; }\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

describe("a style prop the block overrides below the spread", () => {
  const card = (block: string, allows = `{ "padding-left"?: string }`) =>
    check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock<${allows}> }) {\n` +
        `  return <div className={@@( ${block} )}>x</div>;\n}\n`,
    });

  test("a shorthand below the spread clears what the caller may send", () => {
    const report = card(`...$(props.css); padding: 8px;`);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("style-prop-overridden");
    expect(report.findings[0].message).toContain("padding-left");
  });

  test("the same property below the spread is reported too", () => {
    const report = card(`...$(props.css); color: red;`, `{ color?: string }`);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("style-prop-overridden");
  });

  test("above the spread it is quiet, and that is the order a slot is for", () => {
    expect(card(`padding: 8px; ...$(props.css);`).findings).toEqual([]);
  });

  test("a property the slot never promised is quiet", () => {
    expect(card(`...$(props.css); color: red;`).findings).toEqual([]);
  });

  /** A prop that promised nothing in particular cannot have a promise broken. */
  test("an unnarrowed block prop is quiet", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) { return <div className={@@( ...$(props.css); padding: 8px; )}>x</div>; }\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

/**
 * Spreading a block that might not be there.
 *
 * An optional prop — `css?: CssBlock` — is the ordinary shape for a style a caller MAY send, so it
 * is the shape a constrained prop has almost every time. The type used to refuse it while the
 * runtime had always skipped it, which is a type stricter than the thing it describes.
 */
describe("a spread of something that may be absent", () => {
  const spreading = (type: string) =>
    check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: ${type} }) {\n` +
        `  return <div className={@@( color: red; ...$(props.css); )}>x</div>;\n}\n`,
    });

  test("an optional block spreads", () => {
    expect(spreading("CssBlock").findings).toEqual([]);
  });

  test("and a conditional one, which is what `cond && block` is", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { on: boolean; css: CssBlock }) {\n` +
        `  return <div className={@@( color: red; ...$(props.on && props.css); )}>x</div>;\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });

  /** The refusal itself has to survive, or this loosening would have removed the check. */
  test("but something that is not a block is still refused", () => {
    const report = spreading("{ className: string }");

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("only a style block can be spread");
  });

  /**
   * **A BLOCK IS A STRING NOW, and a string is not a block.** Asked because it is the question the
   * change invites: if the type is `string & { … }`, has the brand stopped doing anything and is a
   * spread quietly taking whatever it is given?
   *
   * It has not, and each row below is a different way of arriving at a bare `string`. The last is
   * the one the brand buys that the old object shape could not even express: **concatenation loses
   * it**, so two blocks joined with a template cannot be handed to a spread and the merge cannot be
   * bypassed with `+`.
   */
  test.each([
    ["a bare `string`", "string"],
    ["a string literal type", `"r-c-red"`],
    ["a union with a string in it", "CssBlock | string"],
    ["`any`'s honest cousin, `unknown`", "unknown"],
  ])("a spread of %s is refused", (_what, type) => {
    const report = spreading(type);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("only a style block can be spread");
  });

  /**
   * **Two findings, and they are two different faults on one line.** The spread refuses the joined
   * string because concatenation loses the brand; `blocks-joined-not-merged` says the join itself
   * was the mistake, whatever it was going to be used for. Both are kept on purpose — the typed
   * rules are left out of `inOrder`'s dedup for exactly this reason.
   */
  test("and two blocks joined with a template are refused, because concatenation loses the brand", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { a: CssBlock; b: CssBlock }) {\n` +
        `  return <div className={@@( ...$(\`\${props.a} \${props.b}\`); )}>x</div>;\n}\n`,
    });

    const said = report.findings.map((one) => one.message).join("\n");
    expect(said).toContain("only a style block can be spread");
    expect(said).toContain("mergeClassNames(a, b)");
    expect(report.findings).toHaveLength(2);
  });

  /**
   * **`className` takes any string, and that is not a hole in this.** A block is a string so it goes
   * there, and so does every other class name somebody writes — narrowing `className` on an
   * intrinsic element would refuse `className="lead"`.
   *
   * What narrows is the PROP a component declares. `css?: CssBlock<CardStyle>` refuses a property
   * the slot does not allow, and it refuses a bare `string` for the same reason a spread does; a
   * prop declared `string` narrows nothing, whatever it is called. See *a block a prop can
   * constrain*.
   */
  /**
   * **A PROP PUT STRAIGHT ON `className` IS A USE**, and it stopped being one when `css` went.
   *
   * `neverUsed` counts a JSX attribute as a use by NAME, because the prop's own type is a structural
   * shape this compiler may not import. `css` was that name; a block is a string now and goes on
   * `className`, which is the shape every component that forwards styles has. Reported as a prop
   * nobody used — a false report on the ordinary case, which is the one failure a checker does not
   * survive.
   */
  test("a prop put straight on `className` is used, and is not reported", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) { return <div className={props.css}>x</div>; }\n`,
    });

    expect(report.findings.map((one) => one.code)).not.toContain("style-prop-never-used");
  });

  test("a component's own prop still refuses a bare string", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) { return <div className={props.css}>x</div>; }\n`,
      "Use.tsx": `import { Card } from "./Card";\ndeclare const loose: string;\nconst a = <Card css={loose} />;\nexport default a;\n`,
    });

    expect(report.findings.length).toBeGreaterThan(0);
  });
});

/**
 * ~~A prop that takes only a static block.~~ **Every block is static now.**
 *
 * `StaticCssBlock` was the per-prop half of a setting: `ramonda.css.ts` could refuse a runtime
 * value for a whole project, and a component published to other projects could not rely on theirs,
 * so it said the same thing in its API. Both are gone, because a runtime value in a declaration is
 * refused everywhere — `hole-not-allowed` — and a refusal a caller cannot get past needs no second
 * spelling. `CssBlock` lost its second type parameter with it.
 *
 * What stays is the assertion that made the removal safe: a caller sending a runtime value is
 * refused, wherever in the block it stands, and told what to write instead.
 */
describe("a runtime value sent to a prop", () => {
  const calling = (block: string) =>
    check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock }) { return <div className={props.css}>x</div>; }\n`,
      "Use.tsx":
        `import { Card } from "./Card";\n` +
        `class Host { brand = "red"; render() { return <Card css={@@( ${block} )} />; } }\n` +
        `export default Host;\n`,
    });

  test("a written value is quiet", () => {
    expect(calling(`color: red;`).findings).toEqual([]);
  });

  test.each([
    ["at the top level", `color: $(this.brand);`],
    ["inside a nested rule", `color: red;\n  &:hover { color: $(this.brand); }`],
    ["and inside a conditional group", `color: red;\n  when $(this.brand) { color: $(this.brand); }`],
  ])("one %s is refused, in the file that wrote it", (_what, block) => {
    const report = calling(block);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("hole-not-allowed");
    expect(report.findings[0].file).toContain("Use.tsx");
  });

  /** The whole reason refusing one is affordable: a variant is still sayable without it. */
  test("a condition is not a runtime value, so a variant still goes through", () => {
    expect(calling(`color: red;\n  when $(this.brand) { color: blue; }`).findings).toEqual([]);
  });
});

/**
 * TWO BLOCKS JOINED INTO ONE STRING, where `merge` was meant.
 *
 * A block is a string, so a browser takes the join — and every class from both lands, with the
 * STYLESHEET breaking the tie instead of the call site. Measured through the real runtime:
 *
 *     base = padding-left: 40px    card = padding: 8px
 *     merge  panel r-cur-pointer r-disp-flex r-p-8px
 *     join   panel r-pl-40px r-cur-pointer r-disp-flex r-p-8px
 *
 * The brand already refuses a joined string where a BLOCK is wanted — asserted six ways in
 * `brand.types.test.ts` — but `className` takes a plain `string`, so the one place it matters is
 * the one place the type cannot speak.
 */
describe("two blocks joined into one string", () => {
  const card = (body: string) =>
    check({
      "Card.tsx":
        `const base = @@( padding-left: 40px; );\nconst card = @@( padding: 8px; );\n` +
        `declare const lead: string;\n` +
        `export const a = <div className={${body}}>x</div>;\n`,
    });

  test.each([
    ["a template", "`${base} ${card}`"],
    ["a `+`", "base + card"],
    ["a `+` chain with a separator between", 'base + " " + card'],
    ["an array joined", '[base, card].join(" ")'],
  ])("%s is reported", (_what, body) => {
    const report = card(body);

    expect(report.findings.map((one) => one.code)).toContain("blocks-joined-not-merged");
    expect(report.findings[0].message).toContain("mergeClassNames(a, b)");
  });

  /** And once, not once per operator — a `+` chain is one join however many `+` it holds. */
  /**
   * A `className` PROP joined with a block, which is the shape a splitting compiler made sharper.
   *
   * The rule counts BLOCKS, told apart by their brand, and a prop declared `string` carries none —
   * so a component that takes `className: string` and joins it was quiet. That is the ordinary way
   * a component is written when it does not use the block type, and it is where the merge never
   * runs: the caller's classes and the component's own both land, and the stylesheet decides alone.
   *
   * Told by the NAME, because the type cannot help: a block arriving as a `string` looks exactly
   * like a foreign class name, and reporting those is refused right below.
   */
  test.each([
    ["a template", "`${props.className} ${own}`"],
    ["a `+`", 'props.className + " " + own'],
    ["a bare className variable", "`${className} ${own}`"],
  ])("a `className` prop joined with a block, with %s, is reported", (_what, body) => {
    const report = check({
      "Card.tsx":
        `const own = @@( padding-left: 40px; );\n` +
        `declare const className: string;\n` +
        `declare const props: { className: string };\n` +
        `export const a = <div className={${body}}>x</div>;\n`,
    });

    expect(report.findings.map((one) => one.code)).toContain("blocks-joined-not-merged");
  });

  test("a chain is one finding, not one per `+`", () => {
    expect(card('base + " " + card').findings).toHaveLength(1);
  });

  /**
   * **ONE block beside anything else is the shape the documentation teaches, and it is correct.**
   * A foreign class keys on itself, so merging it changes nothing — measured, the two give the same
   * string byte for byte. Reporting it would be a false report on the ordinary case.
   */
  test.each([
    ["a class of your own, in a template", "`lead ${card}`"],
    ["a class of your own, with `+`", 'lead + " " + card'],
    ["the same block twice, which is not two", "`${card} ${card}`"],
    ["a block alone", "card"],
    ["a merge, which is the answer", "merge(lead, base, card)"],
  ])("%s is not reported", (_what, body) => {
    const report = check({
      "Card.tsx":
        `const base = @@( padding-left: 40px; );\nconst card = @@( padding: 8px; );\n` +
        `declare const lead: string;\n` +
        `declare function merge(...parts: string[]): string;\n` +
        `export const a = <div className={${body}}>x</div>;\n`,
    });

    expect(report.findings.map((one) => one.code)).not.toContain("blocks-joined-not-merged");
  });
});

/**
 * `style-prop-overridden`, at the edges — the shapes a block really takes.
 *
 * The rule compares a spread with what is written BELOW it in the same group, and a block is more
 * than a flat list: it holds conditional groups, nested rules and more than one spread.
 */
describe("what counts as below the spread", () => {
  const card = (block: string, allows = `{ "padding-left"?: string; color?: string }`) =>
    check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { on: boolean; css?: CssBlock<${allows}> }) {\n` +
        `  return <div className={@@( ${block} )}>x</div>;\n}\n`,
    });

  const rules = (block: string) => card(block).findings.map((one) => one.code);

  test("a conditional group below the spread still clears", () => {
    expect(rules(`...$(props.css); when $(props.on) { padding: 8px; }`)).toEqual(["style-prop-overridden"]);
  });

  test("a conditional group ABOVE it does not", () => {
    expect(rules(`when $(props.on) { padding: 8px; } ...$(props.css);`)).toEqual([]);
  });

  test("a nested rule is its own group, so what is inside it is not below the outer spread", () => {
    expect(rules(`...$(props.css); &:hover { padding: 8px; }`)).toEqual([]);
  });

  /**
   * It never arises: a spread may stand only at a block's top level or inside `when $( … ) { … }`, because
   * a block carries the context its declarations were written in. `spread-out-of-place` is what
   * says so, and it says it first.
   */
  test("a spread cannot go inside a nested rule at all, so the question never arises", () => {
    expect(rules(`&:hover { ...$(props.css); padding: 8px; }`)).toContain("spread-out-of-place");
  });

  /**
   * A longhand below a shorthand the caller may send is NOT a fault: `padding` sets four sides and
   * a later `padding-left` replaces one of them, so what the caller sent still mostly stands. Only
   * a declaration that CLEARS theirs is reported.
   */
  test("a longhand below a spread that allows the shorthand is quiet", () => {
    expect(card(`...$(props.css); padding-left: 4px;`, `{ padding?: string }`).findings).toEqual([]);
  });

  /**
   * **Two spreads are two promises and one declaration is still one fault.** Written the other way
   * round first — every spread, then everything after it — and this reported the same `padding`
   * twice, at the same character.
   */
  test("two spreads: a declaration below both is reported once", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: {\n` +
        `  a?: CssBlock<{ "padding-left"?: string }>;\n` +
        `  b?: CssBlock<{ "padding-top"?: string }>;\n` +
        `}) {\n` +
        `  return <div className={@@( ...$(props.a); ...$(props.b); padding: 8px; )}>x</div>;\n}\n`,
    });

    expect(report.findings.map((one) => one.code)).toEqual(["style-prop-overridden"]);
    // and it names BOTH, because a later spread does not undo what an earlier one promised
    expect(report.findings[0].message).toContain("padding-left");
    expect(report.findings[0].message).toContain("padding-top");
  });
});

/**
 * The two ways a rule is told it is wrong, and the TYPED rules have to honour both.
 *
 * Every rule in `rules.ts` gets this for free — `checkBlock` filters the silenced ones and
 * `checkedSource` drops the ignored ones. The typed rules take neither path, so a rule with no
 * escape hatch is what they were until this was asserted.
 */
describe("silencing a typed rule", () => {
  const unused =
    `import type { CssBlock } from "@ramonda/css/properties";\n` +
    `export function Card(props: { css?: CssBlock }) {\n` +
    `  return <div className={@@( color: red; )}>x</div>;\n}\n`;

  test("it is reported when nothing says otherwise", () => {
    expect(check({ "Card.tsx": unused }).findings.map((one) => one.code)).toEqual(["style-prop-never-used"]);
  });

  test("switched off by id in ramonda.css.ts, it is quiet", () => {
    const report = check({
      "Card.tsx": unused,
      "ramonda.css.ts": `export default { rules: { "style-prop-never-used": "off" } };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("and the other typed rule is switched off the same way", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock<{ "padding-left"?: string }> }) {\n` +
        `  return <div className={@@( ...$(props.css); padding: 8px; )}>x</div>;\n}\n`,
      "ramonda.css.ts": `export default { rules: { "style-prop-overridden": "off" } };\n`,
    });

    expect(report.findings).toEqual([]);
  });

  test("the ignore directive covers the next line, and says who took responsibility", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(\n` +
        `  // ramonda-css-ignore the prop is forwarded by a wrapper this file cannot see\n` +
        `  props: { css?: CssBlock },\n` +
        `) {\n` +
        `  return <div className={@@( color: red; )}>x</div>;\n}\n`,
    });

    expect(report.findings).toEqual([]);
    expect(report.exempted).toHaveLength(1);
    expect(report.exempted[0].reason).toContain("forwarded by a wrapper");
  });
});

/**
 * A component that declares a style prop and holds NO block of its own.
 *
 * It is an ordinary shape — a wrapper that only hands its prop on — and it has no overlay, so it
 * is in none of the per-file maps the block pass fills. Both halves are asserted: that the rule
 * still speaks there, and that the author can still tell it it is wrong.
 */
describe("a style prop in a file with no block", () => {
  const wrapper = (extra = "") =>
    `import type { CssBlock } from "@ramonda/css/properties";\n` +
    `export function Card(${extra}props: { css?: CssBlock }) {\n` +
    `  return <div className="card">x</div>;\n}\n`;

  test("it is still reported", () => {
    expect(check({ "Card.tsx": wrapper() }).findings.map((one) => one.code)).toEqual(["style-prop-never-used"]);
  });

  test("and the ignore directive still silences it", () => {
    const report = check({
      "Card.tsx": wrapper(`\n  // ramonda-css-ignore a wrapper this file cannot see spreads it\n  `),
    });

    expect(report.findings).toEqual([]);
    expect(report.exempted).toHaveLength(1);
  });

  test("and so does the config", () => {
    const report = check({
      "Card.tsx": wrapper(),
      "ramonda.css.ts": `export default { rules: { "style-prop-never-used": "off" } };\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

/**
 * What a typed finding must NOT do to the diagnostics around it.
 *
 * Both were found by building one file where a typed finding and a TypeScript one land on the same
 * character — a component that takes a block and passes one on, which is the ordinary shape for a
 * wrapper.
 */
describe("a typed rule beside the compiler", () => {
  const passing =
    `import type { CssBlock } from "@ramonda/css/properties";\n` +
    `declare function Inner(p: { css?: CssBlock<{ color?: string }> }): JSX.Element;\n` +
    `export function Card(props: { css?: CssBlock<{ "padding-left"?: string }> }) {\n` +
    `  return <Inner css={@@( ...$(props.css); padding: 8px; )} />;\n}\n`;

  /**
   * `padding` is refused by the receiving slot AND clears what this component's caller may send.
   * Two different faults at one character, and the dedup between rules and the compiler used to
   * drop the compiler's — so a real type error disappeared behind a rule that never said it.
   */
  test("it does not silence a TypeScript error at the same character", () => {
    const codes = check({ "Card.tsx": passing }).findings.map((one) => one.code);

    expect(codes).toContain("style-prop-overridden");
    expect(codes).toContain(2353);
  });

  /**
   * An ambient declaration has no body, so nothing in it can ever put a prop on an element —
   * reporting one is a fault the author cannot act on and cannot be right about.
   */
  test("a prop on an ambient declaration is never reported", () => {
    const said = check({ "Card.tsx": passing }).findings.filter((one) => one.code === "style-prop-never-used");

    expect(said).toEqual([]);
  });

  test("and an interface declared beside a component is not a subject either", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export interface CardProps { css?: CssBlock }\n` +
        `export function Card(props: CardProps) { return <div className={@@( ...$(props.css); )}>x</div>; }\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

/**
 * `match`, through a real `ts.Program` — the half a runtime test cannot reach.
 *
 * Three things are checked and each costs a parameter of the helper the virtual file writes: the
 * subject is the author's own expression, every key must be something the subject can hold, and
 * every arm's value is judged by the PROPERTY rather than by the call.
 */
describe("a match, type-checked", () => {
  const card = (block: string, field = `variant: "primary" | "secondary" = "primary"`) =>
    check({
      "Card.tsx": `class Card {\n  ${field};\n  render() {\n    return <div className={@@( ${block} )}>x</div>;\n  }\n}\nexport default Card;\n`,
    });

  test("arms the subject can hold are quiet", () => {
    expect(card(`color: match $(this.variant) { primary => red; secondary => blue; };`).findings).toEqual([]);
  });

  test("a key the subject can never hold is reported, at the key", () => {
    const report = card(`color: match $(this.variant) { primary => red; tertiary => blue; };`);

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0].message).toContain("tertiary");
  });

  test("an arm's value is judged by the property, not by the call", () => {
    const report = card(`position: match $(this.variant) { primary => statik; secondary => absolute; };`);

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.map((one) => String(one.message)).join(" ")).toContain("statik");
  });

  test("a fault inside the SUBJECT is reported where it is written", () => {
    const report = card(`color: match $(this.varaint) { primary => red; };`);

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.map((one) => String(one.message)).join(" ")).toContain("varaint");
  });

  test("`_` needs no key the subject can hold", () => {
    expect(card(`color: match $(this.variant) { primary => red; _ => inherit; };`).findings).toEqual([]);
  });
});

/**
 * `narrower-after-a-whole-shorthand` across blocks — what the compiler cannot see, since a spread is
 * a value. The checker follows the spread to the block it names and reads what it sets, the way the
 * compiler reads its own block. Two whole shorthands, the narrower later, are both in `v` and no
 * order serves both; the merge warns about it in development, and this says it at the line.
 */
describe("a narrower whole shorthand after a wider one from another block", () => {
  const codes = (files: Record<string, string>) => check(files).findings.map((one) => one.code);

  test("through a spread in the same file", () => {
    expect(
      codes({
        "Card.tsx": `const base = @@( border: var(--x); );\nexport const card = @@( ...$(base); border-top: var(--y); );\n`,
      }),
    ).toContain("narrower-after-a-whole-shorthand");
  });

  test("through a spread of a block from another file", () => {
    expect(
      codes({
        "base.ts": `export const base = @@( font: caption; );\n`,
        "Card.tsx": `import { base } from "./base";\nexport const card = @@( ...$(base); font-variant: var(--v); );\n`,
      }),
    ).toContain("narrower-after-a-whole-shorthand");
  });

  const PACKAGE_MERGE = {
    "node_modules/@ramonda/css/index.d.ts": `export declare function mergeClassNames(...parts: unknown[]): string;\n`,
    "node_modules/@ramonda/css/package.json": `{ "name": "@ramonda/css", "types": "index.d.ts" }\n`,
  };

  test("but not through an app's own function that happens to share the name", () => {
    expect(
      codes({
        "Card.tsx":
          `const mergeClassNames = (...parts: unknown[]) => parts.join(" ");\n` +
          `const base = @@( border: var(--x); );\nconst top = @@( border-top: var(--y); );\n` +
          `export const a = <div className={mergeClassNames(base, top)}>x</div>;\n`,
      }),
    ).not.toContain("narrower-after-a-whole-shorthand");
  });

  test("through mergeClassNames", () => {
    expect(
      codes({
        ...PACKAGE_MERGE,
        "Card.tsx":
          `import { mergeClassNames } from "@ramonda/css";\n` +
          `const base = @@( border: var(--x); );\nconst top = @@( border-top: var(--y); );\n` +
          `export const a = <div className={mergeClassNames(base, top)}>x</div>;\n`,
      }),
    ).toContain("narrower-after-a-whole-shorthand");
  });

  test.each([
    ["the other order, which the merge settles", "border-top: var(--y);", "border: var(--x);"],
    ["a narrower one that splits, whose pieces are stronger", "border: var(--x);", "border-top: 1px solid red;"],
    ["a longhand after it", "border: var(--x);", "border-top-color: red;"],
    ["a wider one that split", "border: 1px solid red;", "border-top: var(--y);"],
    ["two families that do not cover each other", "border: var(--x);", "padding: var(--p);"],
    // The block sets the family itself after the spread, and the merge clears the spread's whole one.
    ["a re-set of the family between them", "border: var(--x);", "border: 1px solid red; border-top: var(--y);"],
    // Of different importance: the important one is under the mirrored `i`, and it decides.
    ["an important wider one", "border: var(--x) !important;", "border-top: var(--y);"],
  ])("not for %s", (_what, first, second) => {
    expect(
      codes({ "Card.tsx": `const base = @@( ${first} );\nexport const card = @@( ...$(base); ${second} );\n` }),
    ).not.toContain("narrower-after-a-whole-shorthand");
  });
});

/**
 * §17: a `$` variable is a `var()` to the sheet, so a shorthand holding one reaches it WHOLE — in a
 * spread's block and in the block after it. The virtual file writes it as a property access,
 * `__vars.border.thin`, or inside a template when it is part of a value, and the walk read only
 * string literals, so these went unreported.
 *
 * The project declares its variables the way codegen does: its properties module exports one name per group.
 */
describe("a `$` variable in a whole shorthand from another block", () => {
  const PROPS =
    `export * from ${JSON.stringify(join(PACKAGE, "src", "properties"))};\n` +
    `export declare const $border: { thin: string; top: string };\nexport declare const $color: { a: string };\n`;
  const CONFIG =
    `import { kind } from ${JSON.stringify(join(PACKAGE, "dist", "config.js"))};\n` +
    `export default { variables: {\n` +
    `  $border: kind("any", { thin: "1px solid red", top: "2px solid blue" }),\n` +
    `  $color: kind("color", { a: "#000" }),\n} };\n`;
  const findings = (base: string, card: string) =>
    checkProject(
      project(
        {
          "props.ts": PROPS,
          "ramonda.css.ts": CONFIG,
          "Card.tsx": `const base = @@( ${base} );\nexport const card = @@( ...$(base); ${card} );\n`,
        },
        "src/props.ts",
      ),
    ).findings;

  test("the project's variables resolve, so nothing else is reported", () => {
    expect(findings("border: $border.thin;", "border-top-color: $color.a;")).toEqual([]);
  });

  test.each([
    ["a variable in each", "border: $border.thin;", "border-top: $border.top;"],
    ["a variable as part of each value", "border: 2px solid $color.a;", "border-top: 1px solid $color.a;"],
    ["a variable as part of the wider one only", "border: 2px solid $color.a;", "border-top: $border.top;"],
  ])("is reported: %s", (_what, base, card) => {
    expect(findings(base, card).map((one) => one.code)).toEqual(["narrower-after-a-whole-shorthand"]);
  });

  test("not for a longhand after it", () => {
    expect(findings("border: $border.thin;", "border-top-color: $color.a;")).toEqual([]);
  });
});

/**
 * §11: an allow-list's literal values, judged as CSS. A component narrowing its slot to
 * `"font-weight"?: "notexisting"` refused every caller and said nothing itself — the value is not
 * CSS, and only the component's author can fix it. Judged by the compiler's own value rules, so a
 * value is refused here exactly when it would be refused written in a block.
 */
describe("an allow-list value that is not CSS", () => {
  const card = (allows: string) =>
    check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `type CardStyle = ${allows};\n` +
        `export function Card(props: { css?: CssBlock<CardStyle> }) {\n` +
        `  return <div className={props.css}>x</div>;\n}\n`,
    }).findings;

  test("is reported, naming the value and the property", () => {
    const found = card(`{ "font-weight"?: "notexisting" | 600 }`).filter((one) => one.code === "allow-list-not-css");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("notexisting");
    expect(found[0]?.message).toContain("font-weight");
  });

  test("and one in a nested state", () => {
    const found = card(`{ "&:hover"?: { color?: "blu" }[] }`).filter((one) => one.code === "allow-list-not-css");
    expect(found).toHaveLength(1);
  });

  test.each([
    `{ "font-weight"?: 400 | 600; gap?: "8px" | "16px" }`,
    `{ color?: "red" | "var(--brand)" }`,
    `{ width?: string }`,
  ])("%s is not", (allows) => {
    expect(card(allows).map((one) => one.code)).not.toContain("allow-list-not-css");
  });
});

/** What the second review found in the cross-block and allow-list checks. */
describe("the cross-block check, second review", () => {
  const found = (files: Record<string, string>) =>
    check(files).findings.filter((one) => one.code === "narrower-after-a-whole-shorthand");

  test("a pair inside one block after a spread is the compiler's, and is said once", () => {
    const report = found({
      "Card.tsx": `const base = @@( color: red; );\nexport const card = @@( ...$(base); border: var(--x); border-top: var(--y); );\n`,
    });
    expect(report).toHaveLength(1);
  });

  test("a block spread a second time counts a second time", () => {
    const report = found({
      "Card.tsx":
        `const a = @@( border: var(--x); );\nconst b = @@( ...$(a); color: red; );\n` +
        `export const card = @@( ...$(a); border: 1px solid red; ...$(b); border-top: var(--y); );\n`,
    });
    expect(report).toHaveLength(1);
  });

  test("after a guarded group nothing is said, since where the group ends is not known here", () => {
    const report = found({
      "Card.tsx":
        `declare const on: boolean;\nconst base = @@( border: var(--x); );\n` +
        `export const card = @@( ...$(base); when $(on) { border: 1px solid red; } border-top: var(--y); );\n`,
    });
    expect(report).toEqual([]);
  });
});

describe("the allow-list check, second review", () => {
  test("a literal that would change how the probe reads is not judged", () => {
    const report = check({
      "Card.tsx":
        `import type { CssBlock } from "@ramonda/css/properties";\n` +
        `export function Card(props: { css?: CssBlock<{ "background-image"?: "url(a;b.png)" }> }) {\n` +
        `  return <div className={props.css}>x</div>;\n}\n`,
    }).findings.map((one) => one.code);
    expect(report).not.toContain("allow-list-not-css");
  });
});

/**
 * A `style` attribute setting a declared variable its declaration does not allow — the attribute's
 * half of `variable-set-against-its-declaration`. Measured before: both spellings passed while
 * `toStyle` refused the same setting.
 */
describe("a `style` attribute setting a declared variable", () => {
  const CONFIG =
    `import { kind } from ${JSON.stringify(join(PACKAGE, "dist", "config.js"))};\n` +
    `export default { variables: { $color: kind("color", {\n` +
    `  sunken: "#f3f4f6",\n` +
    `  moving: { value: "#ffffff", range: ["#ffffff", "#111827"] },\n` +
    `}) } };\n`;
  const found = (jsx: string) => {
    const card = `export const Card = (on: boolean, v: string) => ${jsx};\n`;
    const out = checkProject(project({ "ramonda.css.ts": CONFIG, "Card.tsx": card })).findings;
    return out
      .filter((one) => one.code === "variable-set-against-its-declaration")
      .map((one) => ({ column: one.column, message: one.message }));
  };

  test.each([
    ["an object key", `<p style={{ "--color-sunken": "red" }}>x</p>`, 62],
    ["an object key with a value from code", `<p style={{ "--color-sunken": v }}>x</p>`, 62],
    ["a string", `<p style="color: red; --color-sunken: red">x</p>`, 71],
    ["a string in braces", `<p style={"--color-sunken: red"}>x</p>`, 60],
  ])("a FIXED one is reported: %s, on the name", (_what, jsx, column) => {
    const [only, ...rest] = found(jsx);

    expect(rest).toEqual([]);
    expect(only.column).toBe(column);
    expect(only.message).toContain("`$color.sunken` is declared without a `range`");
  });

  test.each([
    ["a value outside it", `<p style={{ "--color-moving": "red" }}>x</p>`],
    ["one arm of a ternary outside it", `<p style={{ "--color-moving": on ? "#111827" : "red" }}>x</p>`],
  ])("a ranged one is reported for %s", (_what, jsx) => {
    expect(found(jsx).map((one) => one.message)).toEqual([expect.stringContaining("`red` is not in the `range`")]);
  });

  test.each([
    ["a value in the range", `<p style={{ "--color-moving": on ? "#111827" : "#ffffff" }}>x</p>`],
    ["a value from code for a ranged one", `<p style={{ "--color-moving": v }}>x</p>`],
    ["a name nobody declared", `<p style={{ "--brand": "red" }}>x</p>`],
    ["an ordinary property", `<p style={{ color: "red" }}>x</p>`],
  ])("nothing for %s", (_what, jsx) => {
    expect(found(jsx)).toEqual([]);
  });
});
