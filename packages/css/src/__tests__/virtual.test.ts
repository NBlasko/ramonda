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
    expect(body(`const a = <div css=@@( display: flex; gap: 8px; )>x</div>;\n`)).toBe(
      `const a = <div css={__block([{display:"flex"},{gap:"8px"},])}>x</div>;\n`,
    );
  });

  /**
   * Measured, and it decides the headline: a QUOTED key gets `TS2353` with no suggestion, an
   * unquoted one gets `TS2561` and TypeScript's own *did you mean*. So a name that can be written
   * bare is.
   */
  test("a name that is a valid identifier is written bare, because quotes cost the suggestion", () => {
    expect(body(`const a = <div css=@@( color: red; )>x</div>;\n`)).toContain("{color:");
  });

  test("a dashed name has to be quoted, and that is the limit", () => {
    expect(body(`const a = <div css=@@( flex-direction: row; )>x</div>;\n`)).toContain(`{"flex-direction":`);
  });

  test("a value that is entirely one hole is the expression itself, so its own type is checked", () => {
    expect(body(`const a = <div css=@@( padding: {size}; )>x</div>;\n`)).toContain(`{padding:__val((size))}`);
  });

  test("text and a hole together become a template literal, which keeps the pattern", () => {
    expect(body(`const a = <div css=@@( padding: {n}px; )>x</div>;\n`)).toContain("{padding:`${__val((n))}px`}");
  });

  test("a nested rule holds an array of its own, so its declarations are checked one by one too", () => {
    expect(body(`const a = <div css=@@( &:hover { color: red; } )>x</div>;\n`)).toContain(
      `{"&:hover":[{color:"red"},]},`,
    );
  });

  test("a property's case is folded, because CSS reads it that way", () => {
    expect(body(`const a = <div css=@@( DISPLAY: flex; )>x</div>;\n`)).toContain("{display:");
  });

  test("a custom property keeps its case, because CSS keeps it", () => {
    expect(body(`const a = <div css=@@( --Brand: red; )>x</div>;\n`)).toContain(`"--Brand"`);
  });

  test("the expression is parenthesised, so a comma inside cannot change the call", () => {
    expect(body(`const a = <div css=@@( color: {(a, b)}; )>x</div>;\n`)).toContain(`{color:__val(((a, b)))}`);
  });

  test("a backtick in the CSS cannot end the template literal it lands in", () => {
    expect(body('const a = <div css=@@( content: "`${x}" {y}; )>x</div>;\n')).toContain("\\`\\${x}");
  });

  /**
   * Four declarations now — the block's shape, composition's two, and what a hole in a value must be
   * — and the claim is about all of them: `declare`, never `import`. An import statement would turn
   * a file that is a SCRIPT into a module, which changes what the author's own code means; an import
   * TYPE in a type position does not.
   */
  test("the preamble is declarations, not imports, so a script does not become a module", () => {
    const file = build(`const a = <div css=@@( display: flex; )>x</div>;\n`);
    const preamble = file?.code.slice(0, file.preamble) ?? "";

    // Not `never`, which is what it used to return: assignable everywhere and so never in the way,
    // and read on hover as *this is nothing*. A binding holding a block is what an author points at.
    expect(preamble).toContain(
      `declare function __block(declarations: import("./properties").CssBlockShape[]): import("./properties").CssBlock;`,
    );
    expect(preamble).toContain(`__cond<T>(condition: import("./properties").CssCondition<T>): never;`);
    expect(preamble).toContain(`__from<T>(block: import("./properties").CssSpreadable<T>): never;`);
    expect(preamble).toContain(`__val<T extends import("./properties").CssValue>(value: T): T;`);
    expect(preamble.split("declare function")).toHaveLength(5);
    expect(preamble).not.toMatch(/^\s*import /m);
  });

  test("a file with no block gets no virtual copy at all", () => {
    expect(virtualFile(`const a = 1;\n`)).toBeUndefined();
  });

  test("a decorator says maybe and turns out to be nothing, so there is still no copy", () => {
    expect(virtualFile(`class C {\n  @(dec) m() {}\n}\n`)).toBeUndefined();
  });

  test("a file that already names the helper does not get it taken away", () => {
    const file = build(`const __block = 1;\nconst a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(file?.code).toContain("declare function ___block(");
    expect(file?.code).toContain("const __block = 1;");
  });

  /**
   * A `name=@@(` inside a block belongs to that block's text. The transform refuses one; this passes
   * it over, because a virtual file exists to be type-checked and a refusal belongs to the build.
   */
  test("a block found inside another block is passed over rather than read twice", () => {
    const file = build(`const a = <div css=@@( color: { <b css=@@( color: red; )/> })>x</div>;\n`);

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
    const source = `const before = 1;\nconst a = (\n  <div css=@@(\n    display: flex;\n    gap: 8px;\n  )>x</div>\n);\nconst after = 2;\n`;
    const file = build(source);

    expect(file?.code.split("\n")).toHaveLength(source.split("\n").length);
  });

  test("and every line that is not part of a block is the same line", () => {
    const source = `const before = 1;\nconst a = (\n  <div css=@@(\n    display: flex;\n  )>x</div>\n);\nconst after = 2;\n`;
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
    const source = `const a = (\n  <div css=@@(\n    display: flex;\n    gap: 8px;\n    &:hover {\n      color: red;\n    }\n  )>x</div>\n);\n`;
    const author = source.split("\n");
    const virtual = (build(source)?.code ?? "").split("\n");

    // Each name is looked up on the line the AUTHOR put it on, so the test never counts.
    for (const name of ["display", "gap", "&:hover", "color"]) {
      const line = author.findIndex((text) => text.includes(name));
      expect(virtual[line]).toContain(name);
    }
  });

  test("two blocks in one file each put their own newlines back", () => {
    const source = `const a = (\n  <div css=@@(\n    display: flex;\n  )>x</div>\n);\nconst b = (\n  <p css=@@(\n    color: red;\n  )>y</p>\n);\nconst after = 3;\n`;
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
  const source = `const a = <div css=@@(\n  flex-direction: column;\n  &:hover { color: red; }\n)>x</div>;\n`;
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
  const source = `const accent = 1;\nconst a = <div css=@@( display: flex; color: {accent}; )>x</div>;\n`;
  const file = build(source);
  if (file === undefined) throw new Error("the virtual file found no block");

  /** Where a piece of the virtual file came from in the author's. */
  const from = (needle: string) => file.homeOf(file.code.indexOf(needle));

  test("an expression maps offset for offset, because it was copied", () => {
    expect(from("accent)")).toBe(source.indexOf("accent}"));
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
    const source = `const panel = @@(\n  dsiplay: flex;\n);\nexport default panel;\n`;
    const [only, ...rest] = check(source);

    expect(rest).toEqual([]);
    expect(only.code).toBe(2561);
    expect(only.message).toContain("Did you mean to write 'display'?");
    expect({ line: only.line, column: only.column }).toEqual({ line: 2, column: 3 });
  });

  test("and in one written inside the braces JSX already has", () => {
    const source = `const a = (\n  <div\n    className="lead"\n    css={@@(\n      dsiplay: flex;\n    )}\n  >x</div>\n);\n`;
    const [only, ...rest] = check(source);

    expect(rest).toEqual([]);
    expect(only.code).toBe(2561);
    expect({ line: only.line, column: only.column }).toEqual({ line: 5, column: 7 });
  });

  test("a hole in a value block is still checked in its own scope", () => {
    const source = `class Card {\n  size = true;\n  panel = @@(\n    padding: {this.size};\n  );\n}\n`;
    const [only] = check(source);

    expect(only.code).toBe(2322);
    expect(only.message).toContain("boolean");
  });

  test("a property-name typo is TypeScript's own did-you-mean, on the property", () => {
    const source = `const a = (\n  <div css=@@(\n    dsiplay: flex;\n  )>x</div>\n);\n`;
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
    const source = `const a = (\n  <div css=@@(\n    display: flexx;\n  )>x</div>\n);\n`;
    const [only] = check(source);

    expect(only.code).toBe(2820);
    expect(only.message).toContain(`Did you mean '"flex"'?`);
    expect({ line: only.line, column: only.column }).toEqual({ line: 3, column: 5 });
  });

  test("a hole is checked against the property it stands in, in its own lexical scope", () => {
    // `this.size` resolves to the class's own field, which is the whole point of leaving the
    // expression where the author wrote it rather than lifting it out.
    const source = `class Card {\n  size = true;\n  render() {\n    return (\n      <div css=@@(\n        padding: {this.size};\n      )>x</div>\n    );\n  }\n}\n`;
    const [only] = check(source);

    expect(only.code).toBe(2322);
    expect(only.message).toContain("boolean");
    // The author's own line, on the declaration — see the note above.
    expect({ line: only.line, column: only.column }).toEqual({ line: 6, column: 9 });
  });

  test("a typo inside a nested rule is reported inside the nested rule", () => {
    const source = `const a = (\n  <div css=@@(\n    &:hover {\n      colr: red;\n    }\n  )>x</div>\n);\n`;
    const [only] = check(source);

    expect(only.code).toBe(2561);
    expect(only.message).toContain("Did you mean to write 'color'?");
    expect(only.line).toBe(4);
  });

  test("a name that does not exist is reported where it is written", () => {
    const source = `const a = (\n  <div css=@@(\n    color: {missing};\n  )>x</div>\n);\n`;
    const [only] = check(source);

    expect(only.code).toBe(2304);
    expect(only.message).toContain("missing");
    expect({ line: only.line, column: only.column }).toEqual({ line: 3, column: 13 });
  });

  test("a block that is right reports nothing at all", () => {
    const source = `const size = "8px" as const;\nconst a = (\n  <div css=@@(\n    display: flex;\n    padding: {size};\n    &:hover { color: red; }\n    --brand: red;\n  )>x</div>\n);\n`;

    expect(check(source)).toEqual([]);
  });

  /**
   * The control. Every test above asserts a diagnostic arrives; this one asserts the SCAFFOLDING's
   * own never does — otherwise a virtual file that fails to compile at all would look like a strict
   * one.
   */
  test("and the file this wrote does not report itself", () => {
    const source = `const a = <div css=@@( display: flex; )>x</div>;\n`;
    const file = virtualFile(source, { properties: "/properties" });

    expect(file?.code).toContain("__block");
    expect(check(source)).toEqual([]);
  });
});

/**
 * WHICH RUNS ARE THE AUTHOR'S OWN BYTES — a fact the file records, and used to INFER.
 *
 * A segment maps offset for offset when it is a copy of the author's text, and maps to where it
 * started when it was rewritten. Which of the two it is was decided by asking whether the virtual
 * length equalled the author length — and that is a guess. A review measured it wrong.
 *
 * A value is emitted quoted and whitespace-folded, so the two lengths coincide exactly when folding
 * drops two characters. `sol   id` is eight characters and becomes `"sol id"`, which is also eight.
 * Every span inside such a value was then read as a copied one and came back shifted by the opening
 * quote's worth — one character — so a completion accepted over it left the author's own first and
 * last letters behind: `ssolidd`.
 *
 * `copy` and `derived` now write the answer down. Nothing measures anything.
 */
describe("a rewritten run whose length happens to match the author's", () => {
  const spanOver = (source: string, word: string) => {
    const file = virtualFile(source, { tolerant: true });
    if (file === undefined) throw new Error("no block in the fixture");
    const at = file.code.indexOf(word);
    if (at === -1) throw new Error(`\`${word}\` is not in the virtual text`);
    const span = file.spanOf(at, word.length);
    return span === undefined ? "—" : source.slice(span.start, span.start + span.length);
  };

  /**
   * Three interior spaces fold to one, so `"sol id"` measures as long as `sol   id` did. The whole
   * run is the only honest answer for a rewritten one, and it is what comes back.
   */
  test("a value with three interior spaces, which folds to exactly its own length", () => {
    expect(spanOver(`const a = <div css=@@( border-left-style: sol   id; )>x</div>;\n`, "sol")).toBe("sol   id");
  });

  test("and two trailing spaces, which does the same", () => {
    expect(spanOver(`const a = <div css=@@( flex-direction: col  ; )>x</div>;\n`, "col")).toBe("col  ");
  });

  /** One trailing space: the lengths differ, so this always took the rewritten branch. The control. */
  test("one trailing space, which the inference happened to get right", () => {
    expect(spanOver(`const a = <div css=@@( flex-direction: col ; )>x</div>;\n`, "col")).toBe("col ");
  });

  /** And a genuinely copied run still maps both ends — a hole's contents are the author's own text. */
  test("a hole's expression is copied, and maps offset for offset", () => {
    expect(spanOver(`const a = <div css=@@( color: {this.tone}; )>x</div>;\n`, "this.tone")).toBe("this.tone");
  });
});

/**
 * THE VIRTUAL FILE PARSES, which nothing asked until three faults had already shipped.
 *
 * The tests above check what is written into it — that a declaration becomes a literal, that a hole
 * keeps its parens. None of them ever handed the result to TypeScript, and **a file that does not
 * parse has no semantics to ask about**: every diagnostic in it disappears, so a single unparsable
 * construct silently switches the whole file's checking off. Three shapes did exactly that, and each
 * came back green from every test in this file.
 *
 * All three are refused by the build, which is not a reason to leave the editor broken: an author is
 * owed a working editor for the rest of the file until they run one.
 */
describe("what the virtual file hands TypeScript", () => {
  const parses = (source: string): string[] => {
    const virtual = virtualFile(source, { properties: "./properties", tolerant: true });
    if (virtual === undefined) return [];
    const file = ts.createSourceFile("v.tsx", virtual.code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    return ((file as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? []).map((one) =>
      ts.flattenDiagnosticMessageText(one.messageText, " "),
    );
  };

  test.each([
    ["an ordinary block", "const a = <div css=@@(\n  color: red;\n)>x</div>;\n"],
    ["a braced one", "const a = <div css={@@(\n  color: red;\n)}>x</div>;\n"],
    ["a plain value", "const a = @@(\n  color: red;\n);\n"],
    ["a nested rule", "const a = @@(\n  &:hover { color: red; }\n);\n"],
    ["a hole", "const a = @@(\n  color: {tint};\n);\n"],
    ["a group", "const a = @@(\n  @@if ({on}) { color: red; }\n);\n"],
    ["a spread", "const a = @@(\n  ...{base};\n);\n"],
    ["a named site as a value", "const k = @@keyframes(\n  from { opacity: 0; }\n);\n"],
    ["two blocks in one file", "const a = @@( color: red; );\nconst b = @@( color: blue; );\n"],
    // The three that did not, each for its own reason.
    ["a SHEBANG, which is legal only at offset 0", "#!/usr/bin/env node\nconst a = @@(\n  color: red;\n);\n"],
    ["a NAMED SITE as a bare attribute", "const a = <div css=@@keyframes(\n  from { opacity: 0; }\n)>x</div>;\n"],
    ["a BLOCK NESTED IN A HOLE", 'const a = @@(\n  color: {on ? @@( color: red; ) : "blue"};\n);\n'],
  ])("%s", (_what, source) => {
    expect(parses(source)).toEqual([]);
  });

  /**
   * And the file around the fault is still CHECKED, which is the whole point of not simply refusing.
   * The nested block is written as `null` — nothing of the author's is copied into it, so a caret
   * inside gets no answer, and the declaration beside it gets its own.
   */
  test("a block nested in a hole leaves the rest of the file readable", () => {
    const virtual = build('const a = @@(\n  color: {on ? @@( color: red; ) : "blue"};\n  dsiplay: flex;\n);\n');

    expect(virtual?.code).toContain("(null)");
    expect(virtual?.code).not.toContain("@@(");
    expect(virtual?.code).toContain("dsiplay");
  });

  /** A shebang stays at offset 0, which is the only place it is legal. */
  test("the preamble goes after a shebang, not in front of it", () => {
    const virtual = build("#!/usr/bin/env node\nconst a = @@( color: red; );\n");

    expect(virtual?.code.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  /** And the attribute the site was written as survives, so the tag still has one. */
  test("a named site written as a bare attribute keeps the attribute", () => {
    const virtual = build("const a = <div css=@@keyframes(\n  from { opacity: 0; }\n)>x</div>;\n");

    expect(virtual?.code).toContain("css={__keyframes(");
  });
});
