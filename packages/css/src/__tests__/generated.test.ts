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
    color: kind("color", { primary: { main: "#3b82f6" } }),
    size: kind("length", { control: { md: "30px" }, weight: kind("number", { bold: 700 }) }),
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
      `import { $ } from "../ramonda.css.generated";

export const good = <div css={@@( color: $.color.primary.main; )}>x</div>;
export const inACall = <div css={@@( width: calc($.size.control.md * 2); )}>x</div>;
export const digits = <div css={@@( padding: $.space.inline.2xl; )}>x</div>;
export const outside: string = $.color.primary.main;
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
