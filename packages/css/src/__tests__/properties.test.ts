import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { positionOf } from "../compiler/errors";
import { ARITY, KEYWORDS, PRIMITIVE } from "../compiler/keywords.generated";
import { readBlock } from "../compiler/read";
import { checkBlock } from "../compiler/rules";
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
  const source = `const a = (\n  <div css={@@(\n${css}\n  )}>x</div>\n);\n`;
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
    const source = `class Card {\n  wide = true;\n  render() {\n    return (\n      <div css={@@(\n        position: {this.wide};\n      )}>x</div>\n    );\n  }\n}\n`;
    const file = virtualFile(source, { properties: "../properties" });

    expect(file?.code).toContain("position:__val((this.wide))");
  });

  test("and a hole in an open property takes a string or a number", () => {
    expect(check("    padding: {8}px;")).toEqual([]);
  });
});

/**
 * The 33 properties that had no `KEYWORDS` row because their grammar mentions a `<url>` or a
 * `<string>`.
 *
 * **Reported by a user as `cursor: noned` passing**, and the cause was one line in the generator:
 * `url` and `string` sat in the set of productions that make a word unjudgeable. Neither is a bare
 * word — a `<url>` is `url(…)`, a function, and a `<string>` is quoted — and the checker's scanner
 * steps over both before it reads a word at all. So `cursor` was offered `pointer` as a completion
 * and could not be told `pointerr` was wrong.
 *
 * Both directions are asserted here, because a rule that reports correct CSS is worse than one that
 * misses a typo, and this change could only have gone wrong in the first way.
 */
describe("properties whose grammar mentions a url or a string", () => {
  const of = (declaration: string) => checkBlock(readBlock(`@@(\n  ${declaration};\n)`, 2, "C.tsx").block);

  const GAINED = [
    "backdrop-filter",
    "background",
    "background-image",
    "border-image",
    "border-image-source",
    "clip-path",
    "content",
    "cursor",
    "d",
    "fill",
    "filter",
    "font-feature-settings",
    "font-language-override",
    "font-variation-settings",
    "grid-template-areas",
    "hyphenate-character",
    "list-style-image",
    "marker",
    "marker-end",
    "marker-mid",
    "marker-start",
    "mask",
    "mask-border",
    "mask-border-source",
    "mask-image",
    "offset",
    "offset-path",
    "quotes",
    "shape-outside",
    "stroke",
    "text-emphasis",
    "text-emphasis-style",
    "text-overflow",
  ];

  test("every one of them can be judged now", () => {
    expect(GAINED.filter((one) => KEYWORDS[one] === undefined)).toEqual([]);
  });

  test.each([
    "backdrop-filter: blur(4px)",
    "background: url(a.png) no-repeat center / cover",
    "clip-path: url(#c)",
    "content: attr(data-x)",
    "content: open-quote",
    "cursor: url(a.cur), auto",
    'd: path("M0 0 L1 1")',
    "fill: context-fill",
    "filter: blur(2px) saturate(2)",
    'font-feature-settings: "liga" 1',
    'grid-template-areas: "a b" "c d"',
    'hyphenate-character: "-"',
    "mask: url(m.svg) luminance",
    'offset: path("M0 0") 50%',
    'quotes: "«" "»"',
    "shape-outside: border-box",
    "stroke: url(#g)",
    "text-emphasis: filled dot red",
    'text-overflow: "…"',
  ])("%s is left alone", (declaration) => {
    expect(of(declaration)).toEqual([]);
  });

  test.each([
    "cursor: noned",
    "cursor: pointerr",
    "content: opne-quote",
    "text-overflow: elipsis",
    "clip-path: bordr-box",
    "quotes: aut",
    "filter: non",
    "font-feature-settings: normol",
  ])("%s is reported", (declaration) => {
    expect(of(declaration).map((one) => one.rule)).toEqual(["unknown-value"]);
  });
});

/**
 * A shorthand whose parts are ONE kind is classified; one whose parts differ is not.
 *
 * That line is derivable rather than opinion, and it is the one a project should draw when deciding
 * which shorthands to switch off: `padding`, `margin`, `gap`, `inset`, `border-color` and
 * `border-width` are n of a thing and can be checked; `background`, `border` and `transition` are a
 * width and a style and a colour at once, and nothing can say whether their value is right.
 *
 * Three shapes reached this table late, each found by a user writing ordinary CSS:
 *
 *     gap           <'row-gap'> <'column-gap'>?    a property REFERENCE, not followed
 *     margin-left   … | <anchor-size()>            a FUNCTIONAL type counted as a second primitive
 *     border-color  <color>{1,4}                   a bare type with a MULTIPLIER
 */
describe("which shorthands can be checked at all", () => {
  test.each([
    ["padding", "length-percentage"],
    ["margin", "length-percentage"],
    ["gap", "length-percentage"],
    ["inset", "length-percentage"],
    ["border-color", "color"],
    ["border-width", "length"],
  ])("%s is n of one thing", (property, primitive) => {
    expect(PRIMITIVE[property]).toBe(primitive);
  });

  test.each([["background"], ["border"], ["transition"], ["animation"], ["font"]])(
    "%s is several different things, and stays unclassified",
    (property) => {
      expect(PRIMITIVE[property]).toBeUndefined();
    },
  );

  /**
   * The properties a design system constrains FIRST, and every one of them was unclassified.
   *
   * Found by a design review asking why `variablesOnly: ["length"]` reported `padding-left: 8px`
   * and said nothing about `width: 200px`. Both are one length; only one was classified, and the
   * config author had no way to see which.
   *
   * Three faults in the walk, each a SPELLING rather than a grammar:
   *
   *     fit-content(<length-percentage>)   a call written out, where `<calc-size()>` was skipped
   *     [ auto | … | fit-content(…) ]      parens disqualified an alternation `alternatives` splits
   *     <length-percentage [0,∞]>          the range's comma read as a comma in the grammar
   *
   * Twenty-three properties classified once all three were answered, none lost and none changed
   * kind — asserted against the whole map, because a classifier that gains one property and quietly
   * moves another is worse than one that gains nothing.
   */
  test.each([
    ["width", "length-percentage"],
    ["height", "length-percentage"],
    ["min-width", "length-percentage"],
    ["max-width", "length-percentage"],
    ["min-height", "length-percentage"],
    ["max-height", "length-percentage"],
    ["inline-size", "length-percentage"],
    ["block-size", "length-percentage"],
    ["max-inline-size", "length-percentage"],
    ["flex-basis", "length-percentage"],
    ["margin-inline-start", "length-percentage"],
    ["inset-block-end", "length-percentage"],
  ])("%s is one length, however its grammar spells its calls", (property, primitive) => {
    expect(PRIMITIVE[property]).toBe(primitive);
  });

  /**
   * `border-radius` is STILL unclassified, and it is written down rather than left to be rediscovered.
   *
   * `<length-percentage>{1,4} [ / <length-percentage>{1,4} ]?` — one primitive throughout, but the
   * slash is a separator `sequence` does not read. It is the next one worth doing and it was not
   * done in the same breath, because the three above share a cause and this does not.
   */
  test("`border-radius` is one length and still unclassified, because of the slash form", () => {
    expect(PRIMITIVE["border-radius"]).toBeUndefined();
    expect(PRIMITIVE["border-top-left-radius"]).toBe("length-percentage");
  });

  test("and the ones that repeat carry how many CSS gives them", () => {
    expect(ARITY.padding).toBe(4);
    expect(ARITY["border-color"]).toBe(4);
    expect(ARITY.gap).toBe(2);
    expect(ARITY["padding-block"]).toBe(2);
  });
});
