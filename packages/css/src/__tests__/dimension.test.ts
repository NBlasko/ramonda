import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * `CssDimension` — the one place a hole's value CAN be type-checked, measured through the real `tsc`.
 *
 * ## Why not in the block, which is where a reader would want it
 *
 * A block's value type is `string | number` for 442 of 551 properties, and it has to be. Counted
 * against `mdn-data`: 19 properties take a pure dimensional type, 34 a dimension or a keyword, and
 * **349 are composite** — `border-left` is `<line-width> || <line-style> || <color>`, so
 * `4px solid red` in any order. A type that permits that must permit an arbitrary string, and then
 * it swallows `pddx`. Combinatorics, not laziness.
 *
 * ## So it goes where the value is MADE, and that is better
 *
 * The error lands on the declaration — the line somebody wrote — rather than in the block, which is
 * the same place `unknown-unit` reports `12pddx` written directly. It is opt-in: an annotation, and
 * no `as const` needed, because the annotation IS the context.
 *
 * The unit set is a PARAMETER, which the user asked for: a design system that has decided on `px`
 * says `CssDimension<"px">` and `rem` stops compiling.
 *
 * ## The looseness to be honest about
 *
 * `` `${string}(${string})` `` admits any call, because `calc()`, `min()`, `clamp()` and `var()` can
 * each produce any dimension and nothing in a type can read inside one. So `calc(1rem + 2px)` passes
 * `CssDimension<"px">`, and so would `foo(1)`. The alternative is refusing `calc()`, which would
 * make the type unusable in the one place authors reach for it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const UNITS = join(here, "..", "units.generated");

/** Every error a snippet produces, with the line it is on, through a real program. */
function errors(body: string): { code: number; line: number }[] {
  const FILE = join(here, "dimension.probe.ts");
  const source = `import type { CssDimension, CssLengthUnit } from ${JSON.stringify(UNITS)};\n\ndeclare const w: number;\n${body}\n`;

  const host = ts.createCompilerHost({});
  const fromDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language) =>
    name === FILE ? ts.createSourceFile(name, source, language, true, ts.ScriptKind.TS) : fromDisk(name, language);
  host.readFile = (name) => (name === FILE ? source : ts.sys.readFile(name));
  host.fileExists = (name) => name === FILE || ts.sys.fileExists(name);

  const program = ts.createProgram([FILE], { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true }, host);

  return ts
    .getPreEmitDiagnostics(program)
    .filter((one) => one.file?.fileName === FILE && one.start !== undefined)
    .map((one) => ({
      code: one.code,
      line: (one.file as ts.SourceFile).getLineAndCharacterOfPosition(one.start as number).line + 1,
    }));
}

describe("a unit that is not a unit", () => {
  test("is refused on the declaration", () => {
    const found = errors("const border: CssDimension = `${w}pddx`;");

    expect(found.map((one) => one.code)).toEqual([2322]);
  });

  test.each([
    ["px", "const a: CssDimension = `${w}px`;"],
    ["rem", "const a: CssDimension = `${w}rem`;"],
    ["a percentage", "const a: CssDimension = `${w}%`;"],
    ["a viewport unit", "const a: CssDimension = `${w}vh`;"],
    ["a container unit", "const a: CssDimension = `${w}cqmax`;"],
    ["an angle", "const a: CssDimension = `${w}deg`;"],
    ["zero, as a number", "const a: CssDimension = 0;"],
    ["zero, as text", 'const a: CssDimension = "0";'],
    ["a calc", "const a: CssDimension = `calc(${w}px + 2rem)`;"],
    ["a min", "const a: CssDimension = `min(${w}px, 4rem)`;"],
    ["a var", "const a: CssDimension = `var(--gap)`;"],
  ])("%s is accepted", (_what, body) => {
    expect(errors(body)).toEqual([]);
  });

  /** Where somebody actually writes it: a getter on the component that holds the state. */
  test("and it works in a getter, which is where the value is made", () => {
    expect(
      errors("class Card {\n  weight = 4;\n  get border(): CssDimension {\n    return `${this.weight}px`;\n  }\n}"),
    ).toEqual([]);
  });
});

describe("a unit set the author narrowed", () => {
  test("accepts the one it names", () => {
    expect(errors('const a: CssDimension<"px"> = `${w}px`;')).toEqual([]);
  });

  test.each([
    ["rem", 'const a: CssDimension<"px"> = `${w}rem`;'],
    ["em", 'const a: CssDimension<"px"> = `${w}em`;'],
    ["a second unit it did not name", 'const a: CssDimension<"px" | "rem"> = `${w}vh`;'],
  ])("%s is refused", (_what, body) => {
    expect(errors(body).map((one) => one.code)).toEqual([2322]);
  });

  test("two units, both accepted", () => {
    expect(errors('const a: CssDimension<"px" | "rem"> = `${w}rem`;')).toEqual([]);
  });

  test("the length family refuses a unit from another family", () => {
    expect(errors("const a: CssDimension<CssLengthUnit> = `${w}deg`;").map((one) => one.code)).toEqual([2322]);
  });

  test("and accepts every length", () => {
    expect(errors("const a: CssDimension<CssLengthUnit> = `${w}cqi`;")).toEqual([]);
  });
});
