import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { describe, expect, test } from "vitest";
import { Sheet } from "../compiler/sheet";
import { transform } from "../compiler/transform";

/**
 * A file's stylesheet with a source map, which is what lets a browser's style panel name the `.tsx`
 * line beside a rule — `Card.tsx:3` — instead of the generated CSS.
 *
 * Each assertion reads the map back through a real decoder, the one bundlers use, and asks where
 * the RULE's selector came from: that position is what a style panel links.
 */

/** Where the rule naming `needle` points, as the author's own line of text. */
function origin(file: string, sheet: Sheet, source: string, needle: string): string | undefined {
  const { css, map } = sheet.cssWithMapFor(file, source);
  const lines = css.split("\n");
  const line = lines.findIndex((one) => one.includes(needle));
  if (line === -1) return undefined;
  const found = originalPositionFor(new TraceMap(map as never), {
    line: line + 1,
    column: lines[line]?.indexOf(needle) ?? 0,
  });
  if (found.line === null) return undefined;
  return `${found.source}:${found.line} ${source.split("\n")[found.line - 1]?.trim()}`;
}

const sheetOf = (files: Record<string, string>) => {
  const sheet = new Sheet();
  for (const [file, source] of Object.entries(files)) {
    const built = transform(source, { filename: file });
    if (built !== undefined) sheet.add(file, built.blocks);
  }
  return sheet;
};

describe("a file's stylesheet, with its source map", () => {
  const CARD =
    "export const card = @@(\n" +
    "  padding: 8px;\n" +
    "  color: red;\n" +
    "  &:hover { color: blue; }\n" +
    "  @media (min-width: 40rem) { padding: 24px; }\n" +
    ");\n" +
    "const grow = @@keyframes( from { opacity: 0; } );\n";

  test.each([
    [".r-c-red", "/src/Card.tsx:3 color: red;"],
    // A split piece points at the shorthand it came from.
    [".r-pl-8px", "/src/Card.tsx:2 padding: 8px;"],
    [":hover", "/src/Card.tsx:4 &:hover { color: blue; }"],
  ])("the rule %s points at where it was written", (needle, expected) => {
    expect(origin("/src/Card.tsx", sheetOf({ "/src/Card.tsx": CARD }), CARD, needle)).toBe(expected);
  });

  test("a rule under a condition points at its declaration inside the condition", () => {
    const sheet = sheetOf({ "/src/Card.tsx": CARD });
    const underMedia = sheet.cssFor("/src/Card.tsx").match(/@media [^{]*\{ (\.\S+) \{/)?.[1];

    expect(underMedia).toBeDefined();
    expect(origin("/src/Card.tsx", sheet, CARD, underMedia ?? "")).toBe(
      "/src/Card.tsx:5 @media (min-width: 40rem) { padding: 24px; }",
    );
  });

  test("a named block points at its `@@`", () => {
    const sheet = sheetOf({ "/src/Card.tsx": CARD });
    const name = sheet.cssFor("/src/Card.tsx").match(/@keyframes (r-\S+)/)?.[1];

    expect(name).toBeDefined();
    expect(origin("/src/Card.tsx", sheet, CARD, name ?? "")).toBe(
      "/src/Card.tsx:7 const grow = @@keyframes( from { opacity: 0; } );",
    );
  });

  test("the file's own text travels in the map, so a panel shows it without a server", () => {
    const { map } = sheetOf({ "/src/Card.tsx": CARD }).cssWithMapFor("/src/Card.tsx", CARD);

    expect(map.sources).toEqual(["/src/Card.tsx"]);
    expect(map.sourcesContent).toEqual([CARD]);
  });

  /**
   * One class, two files: each file's stylesheet holds its own copy of the rule, and each copy
   * points at ITS file. A style panel lists both for an element that carries the class, the
   * element's own file among them — a rule is shared, so it has no single origin to give.
   */
  test("a class two files write points, in each file's stylesheet, at that file", () => {
    const one = "export const a = @@( color: red; );\n";
    const two = "\n\nexport const b = @@( color: red; );\n";
    const sheet = sheetOf({ "/src/One.tsx": one, "/src/Two.tsx": two });

    expect(origin("/src/One.tsx", sheet, one, ".r-c-red")).toBe("/src/One.tsx:1 export const a = @@( color: red; );");
    expect(origin("/src/Two.tsx", sheet, two, ".r-c-red")).toBe("/src/Two.tsx:3 export const b = @@( color: red; );");
  });

  test("a class one file writes twice points at the first", () => {
    const source = "export const a = @@( color: red; );\nexport const b = @@( color: red; gap: 1px; );\n";

    expect(origin("/src/Card.tsx", sheetOf({ "/src/Card.tsx": source }), source, ".r-c-red")).toBe(
      "/src/Card.tsx:1 export const a = @@( color: red; );",
    );
  });

  test("a name is found whole, not as the start of a longer one", () => {
    const source = "export const a = @@( color: #fff; );\nexport const b = @@( color: #ffff; );\n";
    const sheet = sheetOf({ "/src/Card.tsx": source });
    const names = [...sheet.cssFor("/src/Card.tsx").matchAll(/\.(r-c-\S+) \{/g)].map((one) => `.${one[1]}`);

    expect(names).toHaveLength(2);
    const [short, long] = [...names].sort((a, b) => a.length - b.length);
    expect(origin("/src/Card.tsx", sheet, source, `${short} `)).toContain(":1 ");
    expect(origin("/src/Card.tsx", sheet, source, `${long} `)).toContain(":2 ");
  });

  test("a nameless at-rule has nothing to be found by, and is left unmapped rather than guessed", () => {
    const source = `const face = @@font-face( font-family: "Brand"; src: url(a.woff2); );\n`;
    const sheet = sheetOf({ "/src/Font.tsx": source });

    expect(sheet.cssFor("/src/Font.tsx")).toContain("@font-face");
    expect(sheet.cssWithMapFor("/src/Font.tsx", source).map.mappings.replaceAll(";", "")).toBe("");
  });
});
