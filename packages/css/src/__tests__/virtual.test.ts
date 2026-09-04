import ts from "typescript";
import { describe, expect, test } from "vitest";
import { positionOf } from "../compiler/errors";
import { virtualFile } from "../compiler/virtual";

/**
 * The claim the whole package rests on, run rather than argued: **a syntax TypeScript cannot parse
 * is still fully type-checked**, and every diagnostic lands on the character the author typed.
 *
 * The shape assertions below are the cheap half. The half that matters is `describe("through tsc")`:
 * a real `ts.Program` over the virtual file, with the diagnostics mapped home.
 */

/**
 * The JSX the author's own project would have. Without it every element is `TS7026`, which would
 * drown the diagnostics this is actually about.
 *
 * `css` is typed the way the framework types it — a value nothing hand-writes — so this also asserts
 * the virtual file's `__block(…)` is assignable to the real prop.
 */
const JSX_TYPES = `
declare namespace JSX {
  interface IntrinsicElements {
    div: {
      className?: string;
      css?: { readonly className: string; readonly properties: readonly string[]; readonly values: readonly (string | number)[] };
      children?: unknown;
    };
  }
  interface Element { readonly _brand: unique symbol }
}
`;

/** Stands in for `@ramonda/css/properties` until track C generates the real one. */
const PROPERTIES = `
type Length = \`\${number}px\` | \`\${number}rem\` | 0;

export interface CssProperties {
  display: "flex" | "block" | "grid" | "none";
  "flex-direction": "row" | "column";
  padding: Length | \`\${Length} \${Length}\`;
  "border-left": string;
  color: string;
}

export type CssBlockShape = Partial<CssProperties> & {
  [nested: \`&\${string}\`]: CssBlockShape[];
} & { [at: \`@\${string}\`]: CssBlockShape[] } & { [custom: \`--\${string}\`]: string | number };
`;

const build = (source: string) => virtualFile(source, { properties: "./properties" });

/**
 * The virtual code with the preamble dropped, which is what the shape assertions are about.
 *
 * Sliced by `preamble` rather than at the first newline: the preamble deliberately ends WITHOUT one,
 * so the virtual file has the same number of lines as the author's.
 */
function body(source: string): string {
  const file = build(source);
  if (file === undefined) throw new Error("the virtual file found no block");
  return file.code.slice(file.preamble);
}

describe("what a block becomes", () => {
  /**
   * One literal PER DECLARATION, in an array. Measured: TypeScript reports one failure per object
   * literal and stops, so a block written as a single literal with three faults reports one of them
   * and the author meets the next on the next run. An array reports all three at once.
   */
  test("an array of one-declaration object literals", () => {
    expect(body(`const a = <div css=@( display: flex; gap: 8px; )>x</div>;\n`)).toBe(
      `const a = <div css={__block([{display:"flex"},{gap:"8px"},])}>x</div>;\n`,
    );
  });

  /**
   * Measured, and it decides the headline: a QUOTED key gets `TS2353` with no suggestion, an
   * unquoted one gets `TS2561` and TypeScript's own *did you mean*. So a name that can be written
   * bare is.
   */
  test("a name that is a valid identifier is written bare, because quotes cost the suggestion", () => {
    expect(body(`const a = <div css=@( color: red; )>x</div>;\n`)).toContain("{color:");
  });

  test("a dashed name has to be quoted, and that is the limit", () => {
    expect(body(`const a = <div css=@( flex-direction: row; )>x</div>;\n`)).toContain(`{"flex-direction":`);
  });

  test("a value that is entirely one hole is the expression itself, so its own type is checked", () => {
    expect(body(`const a = <div css=@( padding: {{size}}; )>x</div>;\n`)).toContain(`{padding:(size)}`);
  });

  test("text and a hole together become a template literal, which keeps the pattern", () => {
    expect(body(`const a = <div css=@( padding: {{n}}px; )>x</div>;\n`)).toContain("{padding:`${(n)}px`}");
  });

  test("a nested rule holds an array of its own, so its declarations are checked one by one too", () => {
    expect(body(`const a = <div css=@( &:hover { color: red; } )>x</div>;\n`)).toContain(
      `{"&:hover":[{color:"red"},]},`,
    );
  });

  test("a property's case is folded, because CSS reads it that way", () => {
    expect(body(`const a = <div css=@( DISPLAY: flex; )>x</div>;\n`)).toContain("{display:");
  });

  test("a custom property keeps its case, because CSS keeps it", () => {
    expect(body(`const a = <div css=@( --Brand: red; )>x</div>;\n`)).toContain(`"--Brand"`);
  });

  test("the expression is parenthesised, so a comma inside cannot change the call", () => {
    expect(body(`const a = <div css=@( color: {{(a, b)}}; )>x</div>;\n`)).toContain(`{color:((a, b))}`);
  });

  test("a backtick in the CSS cannot end the template literal it lands in", () => {
    expect(body('const a = <div css=@( content: "`${x}" {{y}}; )>x</div>;\n')).toContain("\\`\\${x}");
  });

  test("the preamble is a declaration, not an import, so a script does not become a module", () => {
    const file = build(`const a = <div css=@( display: flex; )>x</div>;\n`);

    expect(file?.code.slice(0, file.preamble)).toBe(
      `declare function __block(declarations: import("./properties").CssBlockShape[]): never;`,
    );
  });

  test("a file with no block gets no virtual copy at all", () => {
    expect(virtualFile(`const a = 1;\n`)).toBeUndefined();
  });

  test("a decorator says maybe and turns out to be nothing, so there is still no copy", () => {
    expect(virtualFile(`class C {\n  @(dec) m() {}\n}\n`)).toBeUndefined();
  });

  test("a file that already names the helper does not get it taken away", () => {
    const file = build(`const __block = 1;\nconst a = <div css=@( display: flex; )>x</div>;\n`);

    expect(file?.code).toContain("declare function ___block(");
    expect(file?.code).toContain("const __block = 1;");
  });

  /**
   * A `name=@(` inside a block belongs to that block's text. The transform refuses one; this passes
   * it over, because a virtual file exists to be type-checked and a refusal belongs to the build.
   */
  test("a block found inside another block is passed over rather than read twice", () => {
    const file = build(`const a = <div css=@( color: {{ <b css=@( color: red; )/> }}; )>x</div>;\n`);

    expect(file?.code.match(/__block\(\[/g)).toHaveLength(1);
  });
});

describe("line for line", () => {
  /**
   * A multi-line block becomes ONE line — the whitespace between declarations is text this file never
   * emits — so without the newlines put back, everything below the block moves up. Measured: a
   * nine-line file became seven, plus one for the preamble, so a consumer counting lines was three
   * out.
   *
   * That consumer is real. `scripts/check-examples.mjs` reports a documented example's fault by line
   * and has no source map to consult.
   */
  test("the virtual file has as many lines as the author's", () => {
    const source = `const before = 1;\nconst a = (\n  <div css=@(\n    display: flex;\n    gap: 8px;\n  )>x</div>\n);\nconst after = 2;\n`;
    const file = build(source);

    expect(file?.code.split("\n")).toHaveLength(source.split("\n").length);
  });

  test("and every line that is not part of a block is the same line", () => {
    const source = `const before = 1;\nconst a = (\n  <div css=@(\n    display: flex;\n  )>x</div>\n);\nconst after = 2;\n`;
    const author = source.split("\n");
    const virtual = (build(source)?.code ?? "").split("\n");

    // Line 1 carries the preamble, which is why it ends without a newline of its own.
    expect(virtual[0].endsWith(author[0])).toBe(true);
    // Lines 3 to 5 ARE the block — its closing `)` is on 5, so that line is rewritten too. Every
    // line below it is untouched, and that is the property a line-counting consumer needs.
    for (const line of [6, 7]) expect(virtual[line - 1]).toBe(author[line - 1]);
  });

  /**
   * Inside a block too, and this was measured wrong first: putting every newline AFTER the block
   * collapsed all its declarations onto the block's opening line, so a typo on line 187 was reported
   * on 185. The newlines go between the items.
   */
  test("a declaration is on the line the author put it on", () => {
    const source = `const a = (\n  <div css=@(\n    display: flex;\n    gap: 8px;\n    &:hover {\n      color: red;\n    }\n  )>x</div>\n);\n`;
    const author = source.split("\n");
    const virtual = (build(source)?.code ?? "").split("\n");

    // Each name is looked up on the line the AUTHOR put it on, so the test never counts.
    for (const name of ["display", "gap", "&:hover", "color"]) {
      const line = author.findIndex((text) => text.includes(name));
      expect(virtual[line]).toContain(name);
    }
  });

  test("two blocks in one file each put their own newlines back", () => {
    const source = `const a = (\n  <div css=@(\n    display: flex;\n  )>x</div>\n);\nconst b = (\n  <p css=@(\n    color: red;\n  )>y</p>\n);\nconst after = 3;\n`;
    const virtual = (build(source)?.code ?? "").split("\n");

    expect(virtual).toHaveLength(source.split("\n").length);
    expect(virtual[10]).toBe("const after = 3;");
  });
});

describe("the declaration a caret is in", () => {
  /**
   * A value and a selector both become string literals, and TypeScript answers nothing about a
   * position inside one — measured through a real `tsserver`, hover over `column;` came back empty.
   * So a question that lands nowhere is asked again at the declaration, which is what a reader was
   * asking about anyway.
   */
  const source = `const a = <div css=@(\n  flex-direction: column;\n  &:hover { color: red; }\n)>x</div>;\n`;
  const file = build(source);
  if (file === undefined) throw new Error("the virtual file found no block");

  const at = (needle: string) => file.declarationOf(source.indexOf(needle));

  /**
   * INSIDE the key, not at its start — the same rule `virtualOf` follows, and for the same measured
   * reason: TypeScript answers about a position within a token, and a caret at the very edge of one
   * gets nothing useful. A bare key and a quoted key therefore land differently by one character,
   * which is why this asks about containment rather than counting.
   */
  const keyAt = (offset: number | undefined) => {
    const line = file.code.slice(0, offset).split("\n").pop() ?? "";
    const rest = file.code.slice(offset);
    return `${/[\w"&:.-]*$/.exec(line)?.[0] ?? ""}${/^[\w"&:.\- ]*/.exec(rest)?.[0] ?? ""}`;
  };

  test("a caret in a value finds the property it belongs to", () => {
    expect(keyAt(at("column;"))).toContain("flex-direction");
  });

  test("a caret on the property itself finds the same thing", () => {
    expect(at("flex-direction")).toBe(at("column;"));
  });

  test("a caret in a nested rule's selector finds that rule", () => {
    expect(keyAt(at("&:hover"))).toContain("&:hover");
  });

  /**
   * Innermost first: a declaration inside a nested rule is inside that rule's extent too, and the
   * narrower answer is the one a reader meant.
   */
  test("a caret inside a nested rule's declaration finds the declaration, not the rule", () => {
    const found = keyAt(at("red;"));
    expect(found).toContain("color");
    expect(found).not.toContain("&:hover");
  });

  test("and a caret outside every block finds nothing", () => {
    expect(file.declarationOf(source.indexOf("const a"))).toBeUndefined();
  });
});

describe("the way home", () => {
  const source = `const accent = 1;\nconst a = <div css=@( display: flex; color: {{accent}}; )>x</div>;\n`;
  const file = build(source);
  if (file === undefined) throw new Error("the virtual file found no block");

  /** Where a piece of the virtual file came from in the author's. */
  const from = (needle: string) => file.homeOf(file.code.indexOf(needle));

  test("an expression maps offset for offset, because it was copied", () => {
    expect(from("accent)")).toBe(source.indexOf("accent}}"));
  });

  test("code outside a block maps offset for offset too", () => {
    expect(from("const accent = 1")).toBe(source.indexOf("const accent = 1"));
    expect(from(">x</div>")).toBe(source.indexOf(">x</div>"));
  });

  test("a property name maps to where the author's property starts", () => {
    expect(from("display:")).toBe(source.indexOf("display: flex"));
  });

  test("a value maps to where the author's value starts", () => {
    expect(from(`"flex"`)).toBe(source.indexOf("flex;"));
  });

  test("the scaffolding maps nowhere, which is how a caller drops it", () => {
    expect(from("__block")).toBeUndefined();
    expect(file.homeOf(0)).toBeUndefined();
  });

  test("an offset past the end maps nowhere rather than throwing", () => {
    expect(file.homeOf(file.code.length + 100)).toBeUndefined();
  });
});

/* ---- the half that matters ------------------------------------------------------------------- */

interface Reported {
  readonly code: number;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

/**
 * The three real moves: write the virtual file, hand it to `tsc`, map each diagnostic home.
 *
 * Everything that maps nowhere is dropped, which is the same rule a checker and an editor apply —
 * a diagnostic about `__block` is about the file this wrote.
 */
function check(source: string): Reported[] {
  const file = virtualFile(source, { properties: "/properties" });
  if (file === undefined) throw new Error("the virtual file found no block");

  const VIRTUAL = "/virtual.tsx";
  const files: Record<string, string> = {
    [VIRTUAL]: file.code,
    "/properties.ts": PROPERTIES,
    "/jsx.d.ts": JSX_TYPES,
  };

  const host = ts.createCompilerHost({});
  const fromDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language) =>
    files[name] !== undefined
      ? ts.createSourceFile(
          name,
          files[name],
          language,
          true,
          name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        )
      : fromDisk(name, language);
  host.readFile = (name) => files[name] ?? ts.sys.readFile(name);
  host.fileExists = (name) => files[name] !== undefined || ts.sys.fileExists(name);

  const program = ts.createProgram(
    [VIRTUAL, "/jsx.d.ts"],
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

describe("through tsc, and back to the author's own file", () => {
  /**
   * The two spellings that are a value rather than an attribute, checked the same way.
   *
   * The virtual file has to keep the author's own text to the LEFT of the block in both — `const
   * panel = ` and `css={` are theirs — or a diagnostic about the CSS would land in text nobody
   * wrote, and the shape would not even parse.
   */
  test("a typo in a block written outside JSX is reported where it was written", () => {
    const source = `const panel = @(\n  dsiplay: flex;\n);\nexport default panel;\n`;
    const [only, ...rest] = check(source);

    expect(rest).toEqual([]);
    expect(only.code).toBe(2561);
    expect(only.message).toContain("Did you mean to write 'display'?");
    expect({ line: only.line, column: only.column }).toEqual({ line: 2, column: 3 });
  });

  test("and in one written inside the braces JSX already has", () => {
    const source = `const a = (\n  <div\n    className="lead"\n    css={@(\n      dsiplay: flex;\n    )}\n  >x</div>\n);\n`;
    const [only, ...rest] = check(source);

    expect(rest).toEqual([]);
    expect(only.code).toBe(2561);
    expect({ line: only.line, column: only.column }).toEqual({ line: 5, column: 7 });
  });

  test("a hole in a value block is still checked in its own scope", () => {
    const source = `class Card {\n  size = true;\n  panel = @(\n    padding: {{this.size}};\n  );\n}\n`;
    const [only] = check(source);

    expect(only.code).toBe(2322);
    expect(only.message).toContain("boolean");
  });

  test("a property-name typo is TypeScript's own did-you-mean, on the property", () => {
    const source = `const a = (\n  <div css=@(\n    dsiplay: flex;\n  )>x</div>\n);\n`;
    const [only, ...rest] = check(source);

    expect(rest).toEqual([]);
    expect(only.code).toBe(2561);
    expect(only.message).toContain("Did you mean to write 'display'?");
    expect({ line: only.line, column: only.column }).toEqual({ line: 3, column: 5 });
  });

  /**
   * **Measured: a value error lands on the PROPERTY, not on the value.** TypeScript reports an
   * object literal's assignability errors at the property assignment, whose start is the key — so
   * mapping it home lands on `display`, not on `flexx`.
   *
   * That is not a mapping fault and there is nothing to fix in it: it is what a plain TypeScript
   * object literal does, and the declaration is the right thing to highlight anyway. What it does
   * mean is that the mapped position depends on the KIND of diagnostic, and the test below is the
   * other kind.
   */
  test("a value typo is a did-you-mean too, reported on its declaration", () => {
    const source = `const a = (\n  <div css=@(\n    display: flexx;\n  )>x</div>\n);\n`;
    const [only] = check(source);

    expect(only.code).toBe(2820);
    expect(only.message).toContain(`Did you mean '"flex"'?`);
    expect({ line: only.line, column: only.column }).toEqual({ line: 3, column: 5 });
  });

  test("a hole is checked against the property it stands in, in its own lexical scope", () => {
    // `this.size` resolves to the class's own field, which is the whole point of leaving the
    // expression where the author wrote it rather than lifting it out.
    const source = `class Card {\n  size = true;\n  render() {\n    return (\n      <div css=@(\n        padding: {{this.size}};\n      )>x</div>\n    );\n  }\n}\n`;
    const [only] = check(source);

    expect(only.code).toBe(2322);
    expect(only.message).toContain("boolean");
    // The author's own line, on the declaration — see the note above.
    expect({ line: only.line, column: only.column }).toEqual({ line: 6, column: 9 });
  });

  test("a typo inside a nested rule is reported inside the nested rule", () => {
    const source = `const a = (\n  <div css=@(\n    &:hover {\n      colr: red;\n    }\n  )>x</div>\n);\n`;
    const [only] = check(source);

    expect(only.code).toBe(2561);
    expect(only.message).toContain("Did you mean to write 'color'?");
    expect(only.line).toBe(4);
  });

  test("a name that does not exist is reported where it is written", () => {
    const source = `const a = (\n  <div css=@(\n    color: {{missing}};\n  )>x</div>\n);\n`;
    const [only] = check(source);

    expect(only.code).toBe(2304);
    expect(only.message).toContain("missing");
    expect({ line: only.line, column: only.column }).toEqual({ line: 3, column: 14 });
  });

  test("a block that is right reports nothing at all", () => {
    const source = `const size = "8px" as const;\nconst a = (\n  <div css=@(\n    display: flex;\n    padding: {{size}};\n    &:hover { color: red; }\n    --brand: red;\n  )>x</div>\n);\n`;

    expect(check(source)).toEqual([]);
  });

  /**
   * The control. Every test above asserts a diagnostic arrives; this one asserts the SCAFFOLDING's
   * own never does — otherwise a virtual file that fails to compile at all would look like a strict
   * one.
   */
  test("and the file this wrote does not report itself", () => {
    const source = `const a = <div css=@( display: flex; )>x</div>;\n`;
    const file = virtualFile(source, { properties: "/properties" });

    expect(file?.code).toContain("__block");
    expect(check(source)).toEqual([]);
  });
});
