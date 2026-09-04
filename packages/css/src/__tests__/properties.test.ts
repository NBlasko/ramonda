import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { positionOf } from "../compiler/errors";
import { virtualFile } from "../compiler/virtual";

/**
 * The property map, checked against real CSS through a real `ts.Program`.
 *
 * `virtual.test.ts` proves the mechanism with a five-property fixture. This one uses the map that
 * ships — 551 properties generated from MDN's data — because the two questions it answers cannot be
 * asked of a fixture:
 *
 * - **does a suggestion survive 551 keys?** A spelling heuristic over five names proves nothing
 *   about one over five hundred.
 * - **does it report valid CSS?** That is the failure a type map may not have, and every case below
 *   that expects silence is one that was a false error before something was added to the shape.
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Reported {
  readonly code: number;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

const JSX_TYPES = `
declare namespace JSX {
  interface IntrinsicElements {
    div: { css?: unknown; children?: unknown };
  }
  interface Element { readonly _brand: unique symbol }
}
`;

/**
 * The block, through the real map. The virtual file is served from memory beside the real
 * `properties.ts`, so the import resolves to what the package actually ships.
 */
function check(css: string): Reported[] {
  const source = `const a = (\n  <div css=@(\n${css}\n  )>x</div>\n);\n`;
  const file = virtualFile(source, { properties: "../properties" });
  if (file === undefined) throw new Error("the virtual file found no block");

  const VIRTUAL = join(here, "virtual.tsx");
  const JSX = join(here, "jsx.d.ts");
  const memory: Record<string, string> = { [VIRTUAL]: file.code, [JSX]: JSX_TYPES };

  const host = ts.createCompilerHost({});
  const fromDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language) =>
    memory[name] === undefined
      ? fromDisk(name, language)
      : ts.createSourceFile(
          name,
          memory[name],
          language,
          true,
          name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
  host.readFile = (name) => memory[name] ?? ts.sys.readFile(name);
  host.fileExists = (name) => memory[name] !== undefined || ts.sys.fileExists(name);

  const program = ts.createProgram(
    [VIRTUAL, JSX],
    {
      jsx: ts.JsxEmit.Preserve,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      noEmit: true,
    },
    host,
  );

  const reported: Reported[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.file?.fileName !== VIRTUAL || diagnostic.start === undefined) continue;
    const home = file.homeOf(diagnostic.start);
    if (home === undefined) continue;
    reported.push({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      ...positionOf(source, home),
    });
  }
  return reported;
}

describe("a typo, against five hundred property names", () => {
  test("a property name gets TypeScript's own did-you-mean", () => {
    const [only, ...rest] = check("    dsiplay: flex;");

    expect(rest).toEqual([]);
    expect(only.code).toBe(2561);
    expect(only.message).toContain("Did you mean to write 'display'?");
    expect(only.line).toBe(3);
  });

  test("a value in a closed keyword set gets one too", () => {
    const [only] = check("    position: statik;");

    expect(only.code).toBe(2820);
    expect(only.message).toContain(`Did you mean '"static"'?`);
  });

  /**
   * The message stays one line because `Keyword<…>` is a named alias — TypeScript prints the name
   * instead of expanding the union, and the suggestion survives. Written out at each property, this
   * message would carry the keywords three times over.
   */
  test("and the message is readable, which is why the alias has a name", () => {
    const [only] = check("    position: statik;");

    expect(only.message).toContain("Keyword<");
    expect(only.message.length).toBeLessThan(220);
  });
});

describe("valid CSS the map may not report", () => {
  test.each([
    ["a CSS-wide keyword, which every property accepts", "    position: inherit;"],
    ["a custom property standing in for the value", "    position: var(--placement);"],
    ["one with a fallback", "    position: var(--placement, absolute);"],
    ["an important flag", "    position: absolute !important;"],
    ["a custom property the author declares", "    --brand: #10b981;"],
    ["a vendor-prefixed property MDN does not have to list", "    -webkit-line-clamp: 2;"],
    ["a shorthand nothing could enumerate", "    border-left: 4px solid #10b981;"],
    ["a nested rule", "    &:hover { color: red; }"],
    ["an at-rule", "    @media (min-width: 40rem) { display: grid; }"],
    ["a whole ordinary block", "    display: flex;\n    gap: 8px;\n    padding: 24px 16px;\n    color: #0f172a;"],
  ])("%s", (_what, css) => {
    expect(check(css)).toEqual([]);
  });
});

describe("the limit, said out loud rather than hidden", () => {
  /**
   * `display` is NOT a closed keyword set, and the design used to claim it was. Its grammar allows
   * `inline flow-root`, so a union of its single keywords would reject valid CSS — and that is the
   * one failure a type map may not have.
   *
   * So a `display` typo passes the types. Naming it is the CSS checker's job, where the message is
   * one we write and the grammar is one we can read.
   */
  test("a typo in a property whose grammar is open is not the type system's to catch", () => {
    expect(check("    display: flexx;")).toEqual([]);
    expect(check("    display: inline flow-root;")).toEqual([]);
  });

  test("but the property NAME is still checked, whatever its grammar allows", () => {
    const [only] = check("    dispaly: flex;");

    expect(only.code).toBe(2561);
  });
});

describe("a hole, checked against the property it stands in", () => {
  test("a value that cannot be one is reported on its declaration", () => {
    const source = `class Card {\n  wide = true;\n  render() {\n    return (\n      <div css=@(\n        position: {{this.wide}};\n      )>x</div>\n    );\n  }\n}\n`;
    const file = virtualFile(source, { properties: "../properties" });

    expect(file?.code).toContain("position:(this.wide)");
  });

  test("and a hole in an open property takes a string or a number", () => {
    expect(check("    padding: {{8}}px;")).toEqual([]);
  });
});
