import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { writeGenerated } from "../generate";
import { builtFromThisSource } from "./built";

/** The generated module is IMPORTED, so a stale `dist` would measure a previous version. */
beforeAll(builtFromThisSource);

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/**
 * The REPOSITORY's `node_modules`, not the package's — a package does not contain itself, and this
 * probe has to resolve `@ramonda/css` the way a project installing it would. Measured with the
 * package's own: `TS2307: Cannot find module '@ramonda/css'`, twice, on a feature that works.
 */
const REPO = resolve(PACKAGE, "..", "..");

/**
 * The generated module, RUN and TYPE-CHECKED rather than read.
 *
 * **This file exists because its absence shipped a broken module.** `codegen.test.ts` asserts the
 * text codegen produces, and every one of those assertions passed while the module imported a
 * binding the package did not export — so a project following the documented steps got
 * `TS2307: Cannot find module '@ramonda/css'` and no `$` at all. Text is not behaviour, and the
 * distinction is the whole reason this is separate.
 */

const projects: string[] = [];
afterEach(() => {
  for (const root of projects.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-generated-"));
  projects.push(root);
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
  writeFileSync(
    join(root, "ramonda.css.ts"),
    `import { kind } from "@ramonda/css/config";
export default {
  variables: {
    // A range where the project means to set it at run time — a variable declared with one value
    // says it never changes, and \`toStyle\` holds it to that.
    color: kind("color", { primary: { main: { value: "#3b82f6", range: "any" } } }),
    size: kind("length", { control: { md: { value: "30px", range: ["24px", "30px"] } }, weight: kind("number", { bold: 700 }) }),
    space: kind("length", { inline: { "2xl": "48px" } }),
  },
};
`,
  );
  writeGenerated(root, ts);
  return root;
}

describe("the generated module", () => {
  test("imports nothing at runtime, which is what `$` costs to use", () => {
    const text = readFileSync(join(project(), "ramonda.css.generated.ts"), "utf8");
    const imports = [...text.matchAll(/^import .*$/gm)].map((one) => one[0]);

    // Every import is type-only, so the whole module erases to an object of strings.
    expect(imports).not.toEqual([]);
    for (const line of imports) expect(line.startsWith("import type ")).toBe(true);
  });

  test("and the type it does import is really exported", async () => {
    const text = readFileSync(join(project(), "ramonda.css.generated.ts"), "utf8");

    // Asked of the built declarations rather than of the source, because that is what a project
    // resolves. A type that is not exported is `TS2307` in somebody else's editor.
    const declarations = readFileSync(join(PACKAGE, "dist", "index.d.ts"), "utf8");
    for (const [, bindings] of text.matchAll(/import type \{([^}]*)\} from "@ramonda\/css"/g)) {
      for (const binding of bindings.split(",").map((one) => one.trim())) {
        expect({ binding, exported: declarations.includes(binding) }).toEqual({ binding, exported: true });
      }
    }
  });

  test("runs, and every variable is the `var()` that reads it", async () => {
    const root = project();
    // Rewritten to import the built package by path, so this measures the module rather than the
    // resolver — what the import SAYS is the test above.
    const text = readFileSync(join(root, "ramonda.css.generated.ts"), "utf8").replace(
      `"@ramonda/css"`,
      JSON.stringify(join(PACKAGE, "dist", "index.js")),
    );
    // Written as `.ts` and imported as one: Node strips the types, so the module runs exactly as
    // written rather than as something this test rewrote.
    writeFileSync(join(root, "ran.ts"), text);

    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { $ } = await import(${JSON.stringify(join(root, "ran.ts"))});
         console.log(JSON.stringify({
           colour: String($.color.primary.main),
           length: String($.size.control.md),
           nested: String($.size.weight.bold),
           digits: String($.space.inline["2xl"]),
         }));`,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(out)).toEqual({
      colour: "var(--color-primary-main)",
      length: "var(--size-control-md)",
      nested: "var(--size-weight-bold)",
      digits: "var(--space-inline-2xl)",
    });
  });

  test("type-checks, and a block using `$` type-checks with it", () => {
    const root = project();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(
      join(root, "src", "Card.tsx"),
      `import { read, toStyle } from "@ramonda/css";
import { $, type Value } from "../ramonda.css.generated";

export const good = <div css={@@( color: $.color.primary.main; )}>x</div>;
export const inACall = <div css={@@( width: calc($.size.control.md * 2); )}>x</div>;
export const digits = <div css={@@( padding: $.space.inline.2xl; )}>x</div>;
export const outside: string = $.color.primary.main;

// The two things a project does with a variable outside a block, against the real generated object.
export const theme = toStyle([
  [$.color.primary.main, "#7c3aed"],
  [$.size.control.md, "24px"],
]);
export const now: string = read($.color.primary.main, document.documentElement);

// A value made outside a block, annotated with what the property accepts — the reason Value exists.
const gap: Value<"padding-left"> = "8px";
export const spaced = <div css={@@( padding-left: {gap}; )}>x</div>;
`,
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    let output: string;
    try {
      output = execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }

    expect(output).not.toContain("TS2307");
    expect(output).not.toContain("unknown-variable");
    expect(output).not.toMatch(/problem\(s\)/);
    expect(output).toContain("type-check");
  });

  /**
   * A mistyped `$` path, reported ONCE.
   *
   * The rule and the types both see it, and measured, both spoke — two squiggles at two columns,
   * with the same suggestion in each:
   *
   *     unknown-variable  `$.size.control.mdd` is not a variable this project declares.
   *                       Did you mean `$.size.control.md`?
   *     TS2551            Property 'mdd' does not exist on type
   *                       'Readonly<{ md: Token<"length", "30px">; }>'. Did you mean 'md'?
   *
   * One typo is one fault. Ours is the message kept, because it names the whole path the author
   * wrote and says *this project* — the compiler's names the last segment and a generated type.
   *
   * **The rule is not deleted, which was the first idea.** It is the only thing that speaks in the
   * BUILD: vite and esbuild run these rules over a block and never run TypeScript over it, so
   * dropping the rule would leave a `var()` into a name nothing sets compiling clean. What was
   * wrong was only that two consumers both spoke where one fault existed.
   */
  test.each([
    ["a mistyped leaf", "$.size.control.mdd"],
    ["a path naming nothing at all", "$.nothing.like.it"],
    ["a group, which is a path with no value", "$.size.control"],
  ])("%s is reported once, by the rule that names the project", (_what, path) => {
    const root = project();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(join(root, "src", "Card.tsx"), `export const a = <div css={@@( padding-left: ${path}; )}>x</div>;\n`);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    let output: string;
    try {
      output = execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }

    expect(output).toContain("unknown-variable");
    expect(output).toMatch(/1 problem\(s\)/);
    // The compiler's word about the same path is gone, whichever shape it took.
    expect(output).not.toMatch(/TS2551|TS2339|TS2322/);
  });
});

/**
 * The kind check at the USE SITE, which is the reason ninety-six properties were narrowed.
 *
 * A token is a branded string, so every property accepting `string` accepts all of them — which is
 * why this could not work until a property said what it takes. `padding-left` takes a length now,
 * and a colour is not one.
 */
describe("a variable of the wrong kind", () => {
  const checkedWith = (card: string): string => {
    const root = project();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(join(root, "src", "Card.tsx"), `import { $ } from "../ramonda.css.generated";\n\n${card}`);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    try {
      return execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
  };

  test("a colour in a length slot is refused, and the message names both kinds", () => {
    const output = checkedWith(`export const a = <div css={@@( padding-left: $.color.primary.main; )}>x</div>;\n`);

    expect(output).toContain("problem");
    expect(output).toMatch(/"color"/);
    expect(output).toMatch(/"length"/);
  });

  test("a length in a colour slot is refused", () => {
    const output = checkedWith(`export const b = <div css={@@( background-color: $.size.control.md; )}>x</div>;\n`);

    expect(output).toContain("problem");
    expect(output).toMatch(/CssColor|"color"/);
  });

  test("and the matching kinds still go in, which is the half that must not regress", () => {
    const output = checkedWith(
      `export const c = <div css={@@( padding-left: $.size.control.md; background-color: $.color.primary.main; )}>x</div>;\n`,
    );

    expect(output).not.toContain("problem");
  });
});

/**
 * What narrowing costs, asserted where it applies — in a project that HAS a config.
 *
 * `check.test.ts` has the other half: its probes have no `ramonda.css.ts`, so nothing is narrowed
 * there and a bare `string` goes in. The two files together are the whole claim, which is the point
 * of the correction that put the narrowing here: it is the project's, not everybody's.
 */
describe("a value made outside a block", () => {
  const checkedWith = (card: string): string => {
    const root = project();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(join(root, "src", "Card.tsx"), `import { type Value } from "../ramonda.css.generated";\n\n${card}`);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    try {
      return execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
  };

  test("a bare `string` is refused by a property this project narrowed", () => {
    const output = checkedWith(
      `declare const s: string;\nexport const a = <div css={@@( letter-spacing: {s}; )}>x</div>;\n`,
    );

    expect(output).toContain("problem");
  });

  test("and `Value` is what an author annotates with to satisfy it", () => {
    const output = checkedWith(
      `const spacing: Value<"letter-spacing"> = "0.05em";\nexport const b = <div css={@@( letter-spacing: {spacing}; )}>x</div>;\n`,
    );

    expect(output).not.toContain("problem");
  });

  test("a property nothing narrowed still takes a string, because its grammar is composite", () => {
    const output = checkedWith(
      `declare const s: string;\nexport const c = <div css={@@( border-left: {s} solid red; )}>x</div>;\n`,
    );

    expect(output).not.toContain("problem");
  });
});

/**
 * The config's property rules, end to end — written, generated, and met by a real `tsc`.
 *
 * This is the claim the whole design rests on and the one a person will check first: what they put
 * in `ramonda.css.ts` is what their editor and their build enforce. Each case writes a config,
 * generates, and reads what the real bin says about a real block.
 */
describe("what a project's property rules do", () => {
  const withRules = (rules: string, card: string): string => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-rules-"));
    projects.push(root);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
    writeFileSync(join(root, "ramonda.css.ts"), `export default { properties: ${rules} };\n`);
    writeGenerated(root, ts);

    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(join(root, "src", "Card.tsx"), card);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    try {
      return execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
  };

  test("a shorthand switched off no longer exists, and writing one is reported", () => {
    const output = withRules(
      `{ "*": { shorthand: false } }`,
      `export const a = <div css={@@( padding: 8px; )}>x</div>;\n`,
    );

    expect(output).toMatch(/padding/);
    expect(output).not.toContain("TS2304");
    expect(output).toContain("problem");
  });

  test("and its longhand still goes in, which is what switching it off is FOR", () => {
    const output = withRules(
      `{ "*": { shorthand: false } }`,
      `export const b = <div css={@@( padding-left: 8px; )}>x</div>;\n`,
    );

    expect(output).not.toContain("problem");
  });

  test("one shorthand may be brought back by name", () => {
    const output = withRules(
      `{ "*": { shorthand: false }, margin: { shorthand: true } }`,
      `export const c = <div css={@@( margin: 8px; )}>x</div>;\n`,
    );

    expect(output).not.toContain("problem");
  });

  test("a closed list of values refuses everything else", () => {
    const refused = withRules(
      `{ "z-index": { values: [1, 2, 5, 10] } }`,
      `export const d = <div css={@@( z-index: 3; )}>x</div>;\n`,
    );
    const accepted = withRules(
      `{ "z-index": { values: [1, 2, 5, 10] } }`,
      `export const e = <div css={@@( z-index: 5; )}>x</div>;\n`,
    );

    // The message has to be ABOUT the property. A generated module that does not compile would
    // also report a problem, and did once — `CssGlobal` was used and not imported, so this passed
    // while saying `Cannot find name`. A count is not a reason.
    // The message has to be ABOUT the value. A generated module that does not compile would also
    // report a problem, and did once — `CssGlobal` was used and not imported, so this passed while
    // saying `Cannot find name`. A count is not a reason.
    expect(refused).toMatch(/'"3"' is not assignable/);
    expect(refused).not.toContain("TS2304");
    expect(accepted).not.toContain("problem");
  });

  test("a unit list refuses a unit outside it, and the property still takes the ones in it", () => {
    const refused = withRules(
      `{ "*": { units: ["px"] } }`,
      `export const f = <div css={@@( letter-spacing: 0.05em; )}>x</div>;\n`,
    );
    const accepted = withRules(
      `{ "*": { units: ["px"] } }`,
      `export const g = <div css={@@( letter-spacing: 2px; )}>x</div>;\n`,
    );

    expect(refused).toMatch(/0\.05em/);
    expect(refused).not.toContain("TS2304");
    expect(accepted).not.toContain("problem");
  });

  test("a project with rules and NO variables still gets its module", () => {
    const output = withRules(
      `{ "z-index": { values: [1] } }`,
      `export const h = <div css={@@( z-index: 9; )}>x</div>;\n`,
    );

    expect(output).toContain("problem");
  });
});

/**
 * Two levels of nesting, which is ordinary CSS and which a parameterised shape could not do.
 *
 * `&:hover { & .title { … } }` is written in this repository's own playground, and it is what found
 * the fault: `BlockShapeOf<P>` accepted one level and refused two, because a generic recursive type
 * alias stops expanding at depth. The generated module now writes the shape concretely, and this is
 * the depth that proves it.
 */
describe("a block nested more than once", () => {
  test("two levels are accepted, in a project with its own property map", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-nested-"));
    projects.push(root);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
    writeFileSync(join(root, "ramonda.css.ts"), `export default { properties: { "z-index": { values: [1] } } };\n`);
    writeGenerated(root, ts);

    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(
      join(root, "src", "Card.tsx"),
      `export const a = <div css={@@(\n  color: red;\n  &:hover {\n    & .title {\n      color: blue;\n      &::after { content: ""; }\n    }\n  }\n)}>x</div>;\n`,
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    let output: string;
    try {
      output = execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }

    expect(output).not.toContain("problem");
  });
});

/**
 * **The config is type-checked, which needs it to be in the PROGRAM — and a tsconfig will not be.**
 *
 * `defineConfig` exists so a config is checked as it is written, and none of it runs if the file is
 * not compiled. A config sits at the project root and an ordinary `include` is `["src"]`, so four
 * deliberately wrong configs were written against this repository's own playground and every one
 * compiled. Reported by the user: they wanted the typing they had asked for, rather than writing a
 * config from memory.
 */
describe("a wrong config", () => {
  const checkedWithConfig = (config: string): string => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-badconfig-"));
    projects.push(root);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
    writeFileSync(join(root, "ramonda.css.ts"), config);
    writeFileSync(join(root, "src", "a.ts"), `export const a = 1;\n`);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          types: [],
        },
        // `src` only — which is the ordinary shape, and the reason this was silent.
        include: ["src"],
      }),
    );

    try {
      return execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
  };

  const wrap = (rules: string) =>
    `import { defineConfig } from "@ramonda/css/config";\nexport default defineConfig({ properties: ${rules} });\n`;

  test.each([
    ["a property CSS does not have", `{ "z-indx": { values: [1] } }`, "z-indx"],
    ["`shorthand` on a longhand", `{ color: { shorthand: false } }`, "shorthand"],
    ["an arity CSS does not give", `{ padding: { arity: 7 } }`, "'7' is not assignable"],
    ["a unit that is not one", `{ "*": { units: ["pxx"] } }`, "pxx"],
  ])("%s is reported", (_what, rules, expected) => {
    const output = checkedWithConfig(wrap(rules));

    expect(output).toContain("problem");
    expect(output).toContain(expected);
  });

  test("and a config that is right is silent, which is the control", () => {
    expect(checkedWithConfig(wrap(`{ "z-index": { values: [1, 2] }, padding: { arity: 2 } }`))).not.toContain(
      "problem",
    );
  });
});

/**
 * A variable of the wrong kind in a SHORTHAND, which was accepted.
 *
 * Reported by the user: `gap: $.color.accent.main` compiled. `gap` was unclassified, so it was
 * `string | number`, and a token is a branded string. Two things in the grammar walk had to change —
 * `<'row-gap'>` references are followed now, and a functional type like `<anchor-size()>` no longer
 * counts as a second primitive — which took the classified set from 96 properties to 149.
 */
describe("a shorthand's kind", () => {
  const checkedWith = (card: string): string => {
    const root = project();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(join(root, "src", "Card.tsx"), card);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    try {
      return execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
  };

  test("a colour in a `gap` is refused, naming both kinds", () => {
    const output = checkedWith(`export const a = <div css={@@( gap: $.color.primary.main; )}>x</div>;\n`);

    expect(output).toMatch(/"color"/);
    expect(output).toMatch(/"length"/);
  });

  test("a length in a `gap` goes in", () => {
    expect(checkedWith(`export const b = <div css={@@( gap: $.size.control.md; )}>x</div>;\n`)).not.toContain(
      "problem",
    );
  });

  /**
   * **The multi-value half, which classifying a shorthand broke before it was finished.**
   *
   * Narrowed to ONE value, `padding: 8px 12px` — correct CSS — was refused. Writing the repeat out
   * as `` `${V} ${V}` `` cannot ship: measured, at 49 units by four positions TypeScript silently
   * stops checking. So the type admits a multi-value string, which still refuses a token of the
   * wrong kind.
   */
  test("several values go in where CSS gives several", () => {
    expect(checkedWith(`export const c = <div css={@@( padding: 8px 12px; )}>x</div>;\n`)).not.toContain("problem");
    expect(checkedWith(`export const d = <div css={@@( gap: 4px 8px; )}>x</div>;\n`)).not.toContain("problem");
  });

  /**
   * A space at a text run's BOUNDARY is meaning, and the virtual file was trimming it: `gap: 4px
   * $.space.gutter.tight` became `` `4px${…}` ``, one value rather than two. The emitted CSS was
   * always right; nothing read the virtual file's shape until a multi-value type did.
   */
  test("a value mixing text and a variable keeps the space between them", () => {
    expect(checkedWith(`export const e = <div css={@@( gap: 4px $.size.control.md; )}>x</div>;\n`)).not.toContain(
      "problem",
    );
  });
});

/**
 * A variable's VALUE against the range a property permits — a capability this had and did not use.
 *
 * The emitted slot wrote `Token<"length">`, leaving the value unconstrained, so a variable declared
 * `30px` went into a property narrowed to four values. The user pushed back on my claim that a range
 * over a variable is impossible: for the TYPE it is not, measured. For the browser it is — the
 * spec restricts `@property`'s `syntax` to data type names and custom idents, so `4px | 8px` cannot
 * be written there at all.
 *
 * What it checks is the DECLARED value, which under a theme is the fallback rather than what the
 * browser will use. That limit is narrow and is the honest one: a variable themed into a different
 * range is a different variable.
 */
describe("a variable against a property's range", () => {
  const withBoth = (config: string, card: string): string => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-range-"));
    projects.push(root);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
    writeFileSync(join(root, "ramonda.css.ts"), config);
    writeGenerated(root, ts);
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    );
    writeFileSync(join(root, "src", "Card.tsx"), card);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
        },
        include: ["src", "ramonda.css.generated.ts"],
      }),
    );

    try {
      return execFileSync(process.execPath, [join(PACKAGE, "bin.mjs"), "tsconfig.json"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
  };

  const CONFIG = `import { defineConfig, kind } from "@ramonda/css/config";
export default defineConfig({
  variables: { size: kind("length", { big: "30px", small: "8px" }) },
  properties: { "letter-spacing": { values: ["4px", "8px"] }, "z-index": { values: [1, 2] } },
});
`;

  test("a variable outside the list is refused, and the message names the VALUE", () => {
    const output = withBoth(CONFIG, `export const a = <div css={@@( letter-spacing: $.size.big; )}>x</div>;\n`);

    // `Fixed<…>` because this variable was declared bare — the mark that it never changes. The
    // claim is unchanged: the message names the VALUE and the list it failed against, not the kind.
    expect(output).toMatch(/Fixed<"30px">' is not assignable to type '"8px" \| "4px"'/);
  });

  /**
   * **A closed list had no `Token` in it at all**, so no variable went in — however right. The user
   * met it: `z-index: $.layer.modal` refused with the project's own list in the message.
   */
  test("a variable INSIDE the list goes in, which no variable did", () => {
    const output = withBoth(CONFIG, `export const b = <div css={@@( letter-spacing: $.size.small; )}>x</div>;\n`);

    expect(output).not.toContain("problem");
  });

  test("the value written out is unaffected", () => {
    const output = withBoth(CONFIG, `export const c = <div css={@@( letter-spacing: 8px; )}>x</div>;\n`);

    expect(output).not.toContain("problem");
  });

  test("and the wrong KIND is still refused by its kind, not by its value", () => {
    const config = CONFIG.replace(
      'size: kind("length", { big: "30px", small: "8px" })',
      'c: kind("color", { a: "#fff" })',
    );
    const output = withBoth(config, `export const d = <div css={@@( letter-spacing: $.c.a; )}>x</div>;\n`);

    expect(output).toMatch(/'"color"' is not assignable/);
  });

  /**
   * `units` narrows the UNIT, not the value set — so `30px` in a `px`-only property is right and
   * passes. Asserted because the two read alike and do different things.
   */
  test("`units` is not a range: a px value goes into a px-only property", () => {
    const config = `import { defineConfig, kind } from "@ramonda/css/config";
export default defineConfig({
  variables: { size: kind("length", { big: "30px" }) },
  properties: { "letter-spacing": { units: ["px"] } },
});
`;
    const output = withBoth(config, `export const e = <div css={@@( letter-spacing: $.size.big; )}>x</div>;\n`);

    expect(output).not.toContain("problem");
  });

  /**
   * A bare `0` under `variablesOnly`, which is the most common declaration in CSS.
   *
   * Measured before this, a variables-only `<length>` refused `padding-left: 0`:
   *
   *     Type '"0"' is not assignable to type
   *     'Narrowed<never, Token<"length" | "length-percentage" | "percentage">>'
   *
   * **`0` is not a hardcoded length.** CSS lets a zero length go without a unit, `CssDimension` holds
   * `0 | "0"` for exactly that reason, and a project saying *lengths come from variables* is not
   * saying it wants `$.space.none`. The narrowing threw the dimensionless zero out with the literals
   * because they lived in one type.
   *
   * The two spellings both arrive: a block is CSS, so `padding-left: 0` reaches the type as `"0"`,
   * while a hole can hand it the number.
   *
   * Note the other narrowing never had this fault — `units` leaves the literal type in place and only
   * swaps the unit parameter, so `0` survived it. Two settings, one question, two answers, which is
   * the shape this review kept finding.
   */
  describe("a dimensionless zero, where a kind is variables-only", () => {
    const CONFIG = `import { kind } from "@ramonda/css/config";
  export default {
    variables: { space: kind("length", { gutter: { normal: "16px" } }) },
    properties: { "<length>": { variablesOnly: true } },
  };
  `;

    test.each([
      ["a longhand", "padding-left: 0;"],
      ["another", "margin-top: 0;"],
      ["an inset", "top: 0;"],
      ["beside a variable", "padding-left: $.space.gutter.normal; top: 0;"],
    ])("%s takes a bare zero", (_what, css) => {
      expect(withBoth(CONFIG, `export const a = <div css={@@( ${css} )}>x</div>;\n`)).not.toContain("problem");
    });

    test("and a length written out is still refused, which is the whole setting", () => {
      const output = withBoth(CONFIG, `export const b = <div css={@@( padding-left: 8px; )}>x</div>;\n`);

      expect(output).toContain("problem");
    });

    /** A zero is dimensionless; a number this project wants from a variable is not. */
    test("a variables-only NUMBER still refuses a written-out zero", () => {
      const config = CONFIG.replace('"<length>"', '"<number>"').replace(
        'kind("length", { gutter: { normal: "16px" } })',
        'kind("number", { weight: { bold: 700 } })',
      );
      const output = withBoth(config, `export const c = <div css={@@( flex-grow: 0; )}>x</div>;\n`);

      expect(output).toContain("problem");
    });
  });

  /**
   * `variablesOnly` said as a SELECTOR inside `properties`, which is where it belongs.
   *
   * It was a top-level key listing kinds — `variablesOnly: ["length"]` — which made it the one
   * setting keyed by kind while every other was keyed by property. The user asked whether it could
   * live beside `values` and `arity` instead, and named the cost themselves: a colour reaches 40
   * properties and a length 127, so writing it per property is not a thing anybody will do.
   *
   * A third selector answers both. `properties` already had one — `"*"` is not a property name, it
   * is *every property* — so the map is keyed by three things now, in order of how tightly each
   * binds:
   *
   *     "*"              every property
   *     "<length>"       every property whose value IS that kind
   *     "padding-left"   that property
   *
   * Nothing new to learn: `<length>` is the same word already written in `kind("length", …)`, and
   * the merge is the key-by-key merge presets already depend on. What it buys that the top-level
   * key could not is the EXEMPTION — `variablesOnly` was all-or-nothing per kind, so a project
   * could not say *lengths from variables, except `border-radius`*.
   */
  describe("`variablesOnly` as a selector inside `properties`", () => {
    const CONFIG = `import { kind } from "@ramonda/css/config";
export default {
  variables: { space: kind("length", { sm: "8px" }) },
  properties: {
    "<length>": { variablesOnly: true },
    "border-radius": { variablesOnly: false },
  },
};
`;

    test.each([
      ["a length written out", "padding-left: 8px;", true],
      ["another, reached only by the kind", "max-width: 320px;", true],
      ["the variable it wanted", "padding-left: $.space.sm;", false],
      ["a dimensionless zero", "padding-left: 0;", false],
      ["the property exempted by name", "border-radius: 4px;", false],
    ])("%s", (_what, css, refused) => {
      const output = withBoth(CONFIG, `export const a = <div css={@@( ${css} )}>x</div>;\n`);

      expect(output.includes("problem")).toBe(refused);
    });

    /** A colour reaches composite shorthands no type describes, which is the rule's half. */
    test("a kind selector drives the RULE too, where a property has no type to narrow", () => {
      const config = `import { kind } from "@ramonda/css/config";
export default {
  variables: { brand: kind("color", { main: "#10b981" }) },
  properties: { "<color>": { variablesOnly: true } },
};
`;
      const output = withBoth(config, `export const a = <div css={@@( border: 1px solid red; )}>x</div>;\n`);

      expect(output).toContain("literal-not-allowed");
    });

    test("and a composite property exempted by name is left alone", () => {
      const config = `import { kind } from "@ramonda/css/config";
export default {
  variables: { brand: kind("color", { main: "#10b981" }) },
  properties: { "<color>": { variablesOnly: true }, border: { variablesOnly: false } },
};
`;
      const output = withBoth(config, `export const a = <div css={@@( border: 1px solid red; )}>x</div>;\n`);

      expect(output).not.toContain("problem");
    });

    /** The three selectors on one property, each overriding the one before. */
    test("`*` is overridden by the kind, and the kind by the property's own name", () => {
      const config = `import { kind } from "@ramonda/css/config";
export default {
  variables: { space: kind("length", { sm: "8px" }) },
  properties: {
    "*": { variablesOnly: false },
    "<length>": { variablesOnly: true },
    "padding-left": { variablesOnly: false },
  },
};
`;

      // `*` says no and the kind says yes: the kind binds more tightly.
      expect(withBoth(config, `export const a = <div css={@@( margin-top: 8px; )}>x</div>;\n`)).toContain("problem");
      // the kind says yes and the name says no: the name binds more tightly still.
      expect(withBoth(config, `export const b = <div css={@@( padding-left: 8px; )}>x</div>;\n`)).not.toContain(
        "problem",
      );
    });

    /**
     * A closed `values` list, asked per PROPERTY rather than per config key.
     *
     * The branch that writes a closed list walked `Object.entries(rules)` — the keys somebody typed —
     * while every other setting asks `ruleFor(property)`. That was invisible while the only keys were
     * property names and `"*"`. Three faults fell out of it the moment a user asked what
     * `variablesOnly` means beside a range:
     *
     *     values + variablesOnly      the literal went in anyway; `variablesOnly` was never consulted
     *     "<time>": { values: [...] } emitted a row literally NAMED `"<time>"`, constraining nothing
     *     "*": { values: [...] }      silently did nothing at all
     *
     * The user's own position settled the first, and it was already the behaviour everywhere else:
     * *"variabla takodje mora da postuje range. Ako im se ne svidja, pa onda prosiri range."* A
     * variable is checked against the list by its declared value — `Token<kind, permitted>` — so
     * `variablesOnly` only ever removes the LITERAL spelling. It is not a way around a range.
     */
    describe("a closed list, and what a variable owes it", () => {
      const CONFIG = `import { kind } from "@ramonda/css/config";
export default {
  variables: { s: kind("length", { ok: "8px", big: "30px" }) },
  properties: { "padding-left": { values: ["4px", "8px"] } },
};
`;

      test.each([
        ["a value from the list", "padding-left: 8px;", false],
        ["one outside it", "padding-left: 12px;", true],
        ["a variable whose value is in the list", "padding-left: $.s.ok;", false],
        ["a variable whose value is NOT", "padding-left: $.s.big;", true],
      ])("%s", (_what, css, refused) => {
        expect(withBoth(CONFIG, `export const a = <div css={@@( ${css} )}>x</div>;\n`).includes("problem")).toBe(
          refused,
        );
      });

      /** `variablesOnly` removes the literal spelling and nothing else. The range still binds. */
      test.each([
        ["the literal, which the list permits but the project does not write", "padding-left: 8px;", true],
        ["the variable, whose value the list permits", "padding-left: $.s.ok;", false],
        ["the variable whose value it does not", "padding-left: $.s.big;", true],
      ])("with `variablesOnly` beside the list: %s", (_what, css, refused) => {
        const config = CONFIG.replace('{ values: ["4px", "8px"] }', '{ values: ["4px", "8px"], variablesOnly: true }');

        expect(withBoth(config, `export const a = <div css={@@( ${css} )}>x</div>;\n`).includes("problem")).toBe(
          refused,
        );
      });

      test("a closed list said on a KIND reaches every property of that kind", () => {
        const config = `export default { properties: { "<time>": { values: ["120ms", "400ms"] } } };\n`;

        expect(withBoth(config, `export const a = <div css={@@( transition-duration: 300ms; )}>x</div>;\n`)).toContain(
          "problem",
        );
        expect(
          withBoth(config, `export const b = <div css={@@( transition-duration: 120ms; )}>x</div>;\n`),
        ).not.toContain("problem");
      });

      /** And it must not leave a row named after the selector, which is not a property. */
      test("and writes no property called `<time>`", () => {
        const root = mkdtempSync(join(tmpdir(), "ramonda-closed-"));
        projects.push(root);
        symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
        writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
        writeFileSync(
          join(root, "ramonda.css.ts"),
          `export default { properties: { "<time>": { values: ["120ms"] } } };\n`,
        );
        writeGenerated(root, ts);

        expect(readFileSync(join(root, "ramonda.css.generated.ts"), "utf8")).not.toContain('"<time>":');
      });
    });

    /**
     * What `toStyle` says when a value does not suit the variable — which was `never`, twice.
     *
     * The user asked what `Token<"length", "16px">` shows, since an initial value is not a range. The
     * answer is that it IS the range: a variable declared with a bare value never changes, and one
     * declared `{ value, range }` carries the range instead. The premise was right and the design
     * already agreed with it.
     *
     * **But asking exposed the message.** Measured, every refused setting came back the same way:
     *
     *     toStyle([[$.space.gutter, "24px"]])
     *     TS2322: Type 'Token<"length", "16px">' is not assignable to type 'never'.
     *     TS2322: Type 'string' is not assignable to type 'never'.
     *
     * Two errors, neither naming the variable, the range, or what to do. And not only for the fixed
     * case — a variable with a real range said `never` too, so the range check worked and could not
     * be read. `Permitted` intersected the pair with the permitted pair, and an intersection of two
     * different literals is `never`.
     *
     * The message is the TYPE'S NAME now, which is the one thing TypeScript prints verbatim. It looks
     * odd in the source and it is deliberate: this is the only channel a type has.
     */
    describe("what `toStyle` says when the value does not suit the variable", () => {
      const CONFIG = `import { kind } from "@ramonda/css/config";
export default {
  variables: {
    fixed: kind("length", { gutter: "16px" }),
    themed: kind("length", { gutter: { value: "16px", range: ["8px", "16px"] } }),
    open: kind("length", { gutter: { value: "16px", range: "any" } }),
  },
};
`;
      /** `$` needs importing here: outside a block this is ordinary TypeScript, not our grammar. */
      const HEAD = `import { toStyle } from "@ramonda/css";\nimport { $ } from "../ramonda.css.generated";\n`;
      const setting = (path: string, value: string) =>
        withBoth(CONFIG, `${HEAD}export const t = toStyle([[${path}, ${JSON.stringify(value)}]]);\n`);

      test("a variable declared with ONE value says so, and says what to do about it", () => {
        const output = setting("$.fixed.gutter", "24px");

        expect(output).toContain("this_variable_was_declared_with_one_value");
        expect(output).toContain("give_it_a_range");
        expect(output).not.toMatch(/assignable to type 'never'/);
      });

      test("one with a range names the values it may take", () => {
        const output = setting("$.themed.gutter", "24px");

        expect(output).toContain("this_variable_may_only_be");
        expect(output).toContain('"16px"');
        expect(output).toContain('"8px"');
        expect(output).not.toMatch(/assignable to type 'never'/);
      });

      test.each([
        ["a value inside the range", "$.themed.gutter", "16px"],
        ["any value, where the range is open", "$.open.gutter", "99px"],
      ])("%s is set without complaint", (_what, path, value) => {
        expect(setting(path, value)).not.toContain("problem");
      });

      /** The kind is still checked, which is what `toStyle` did before a range existed at all. */
      test("and a value of the wrong KIND is still refused", () => {
        const config = CONFIG.replace(
          'open: kind("length", { gutter: { value: "16px", range: "any" } }),',
          'brand: kind("color", { main: { value: "#10b981", range: "any" } }),',
        );
        const output = withBoth(config, `${HEAD}export const t = toStyle([[$.brand.main, "30px"]]);\n`);

        expect(output).toContain("problem");
      });

      /** A marked token is still a token: it goes into a block exactly as it did. */
      test("a fixed variable still goes into a block", () => {
        expect(
          withBoth(CONFIG, `export const a = <div css={@@( padding-left: $.fixed.gutter; )}>x</div>;\n`),
        ).not.toContain("problem");
      });
    });
  });
});
