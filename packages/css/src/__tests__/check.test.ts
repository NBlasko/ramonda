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
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "src", name), text);

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
   * The cheap first pass is allowed to say maybe — `@(` is also how a decorator is written, and this
   * is a decorator-heavy framework. A file that turns out to hold no block needs no overlay and no
   * mapping, and its diagnostics are its own.
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
      "Card.tsx": `const a = (\n  <div className="lead" css=@(\n    display: flex;\n    gap: 8px;\n  )>x</div>\n);\nexport default a;\n`,
      "Plain.tsx": `const b = <div>x</div>;\nexport default b;\n`,
    });

    expect(report.findings).toEqual([]);
    expect(report.refused).toBe(false);
    expect(report.styled).toBe(1);
    expect(report.files).toBe(3);
  });

  test("a hole reads the class it was written in", () => {
    const report = check({
      "Card.tsx": `export class Card {\n  accent = "#10b981";\n  render() {\n    return <div css=@( border-left: 4px solid {{this.accent}}; )>x</div>;\n  }\n}\n`,
    });

    expect(report.findings).toEqual([]);
  });
});

describe("a project that is not", () => {
  test("a property typo is reported at the author's own line and column", () => {
    const report = check({
      "Card.tsx": `const a = (\n  <div css=@(\n    dsiplay: flex;\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    const [only] = report.findings;
    expect(only.file).toMatch(/Card\.tsx$/);
    expect(only.line).toBe(3);
    expect(only.column).toBe(5);
    expect(only.message).toContain("Did you mean to write 'display'?");
  });

  test("a hole whose type the property cannot take is reported", () => {
    const report = check({
      "Card.tsx": `export class Card {\n  wide = true;\n  render() {\n    return <div css=@( position: {{this.wide}}; )>x</div>;\n  }\n}\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe(2322);
    expect(report.findings[0].line).toBe(4);
  });

  /**
   * A project using this syntax cannot run plain `tsc` — the compiler refuses the file at the parse
   * step — so this IS its `tsc`. A report that dropped ordinary type errors would look like a
   * passing check on a program nothing checked.
   */
  test("an ordinary type error in a file with a block is reported too", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = <div css=@( display: flex; )>x</div>;\nexport default [n, a];\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].line).toBe(1);
    expect(report.findings[0].code).toBe(2322);
  });

  test("and one in a file with no block at all", () => {
    const report = check({
      "Card.tsx": `const a = <div css=@( display: flex; )>x</div>;\nexport default a;\n`,
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
      "Card.tsx": `const a = (\n  <div css=@(\n    dsiplay: flex;\n    position: statik;\n    &:hover {\n      colr: red;\n    }\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings.map((f) => f.line)).toEqual([3, 4, 6]);
    expect(report.findings[0].message).toContain("Did you mean to write 'display'?");
    expect(report.findings[1].message).toContain(`Did you mean '"static"'?`);
    expect(report.findings[2].message).toContain("Did you mean to write 'color'?");
  });

  test("two files each report their own", () => {
    const report = check({
      "One.tsx": `const a = <div css=@( dsiplay: flex; )>x</div>;\nexport default a;\n`,
      "Two.tsx": `const b = <div css=@( positon: absolute; )>x</div>;\nexport default b;\n`,
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
      "Card.tsx": `const a = (\n  <div css=@(\n    display: flexx;\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-value");
    expect(report.findings[0].line).toBe(3);
    expect(report.findings[0].message).toContain("Did you mean `flex`?");
  });

  test("both kinds arrive in the order a person reads the file", () => {
    const report = check({
      "Card.tsx": `const n: number = "no";\nconst a = (\n  <div css=@(\n    display: flexx;\n  )>x</div>\n);\nexport default [n, a];\n`,
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
      "Card.tsx": `const a = (\n  <div css=@(\n    flex-dirction: row;\n  )>x</div>\n);\nexport default a;\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe("unknown-property");
    expect(report.findings[0].message).toContain("flex-direction");
  });

  test("a TS2353 about something no rule named is still reported", () => {
    // A nested rule's key that matches none of the shape's index signatures — nothing to do with a
    // property name, so nothing of ours claims it.
    const report = check({
      "Card.tsx": `const a = (\n  <div css=@(\n    nope { color: red; }\n  )>x</div>\n);\nexport default a;\n`,
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
      "Card.tsx": `const n: number = "no";\nconst a = <div css=@(\n  {{name}}: 24px;\n)>x</div>;\nexport default [n, a];\n`,
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
      project({ "Card.tsx": `const a = <div css=@( dsiplay: flex; )>x</div>;\nexport default a;\n` }, null),
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
        { "Card.tsx": `const a = <div css=@( display: flex; )>x</div>;\nexport default a;\n` },
        join(root, "empty.ts"),
      ),
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].message).toContain("CssBlockShape");
  });

  test("and it is reported once, whatever the project's size", () => {
    const files: Record<string, string> = {};
    for (let n = 0; n < 4; n++)
      files[`C${n}.tsx`] = `const a${n} = <div css=@( display: flex; )>x</div>;\nexport default a${n};\n`;

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
