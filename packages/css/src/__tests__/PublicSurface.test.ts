import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import * as compiler from "../compiler/index";
import * as api from "../index";

/**
 * What each entry exports, asserted as a list — the same tripwire the other packages have.
 *
 * There are two entries and they are not the same audience. `@ramonda/css` is loaded by every page
 * that renders a block, so anything added to it is shipped to a browser; `@ramonda/css/compiler`
 * runs in a build and may reach for `node:crypto`. The split is what keeps the second out of the
 * first, and a list per entry is what keeps the split honest.
 */
/**
 * `merge` and `compose` are composition's half: a block compiles to a map, and merging maps at the
 * call site is the only place precedence can be decided — measured, the order of classes in a
 * `class` attribute decides nothing. `compose` is the primitive and composes with itself; `merge` is
 * the boundary and produces the value the framework already takes.
 */
const RUNTIME = ["block", "compose", "merge", "toStyleObject"];

/**
 * The TYPES the runtime entry exports, which `Object.keys` cannot see.
 *
 * That blindness was real: seven types were added to this entry and every assertion above stayed
 * green, because a type is gone by the time there is an object to ask. A published type is a promise
 * exactly as a published function is — it is what somebody writes in their own annotation — so it
 * needs the same tripwire, and it needs it read from the SOURCE rather than from a runtime object.
 */
const TYPES = [
  "CssAngleUnit",
  "CssDimension",
  "CssFrequencyUnit",
  "CssLengthUnit",
  "CssResolutionUnit",
  "CssTimeUnit",
  "CssUnit",
  "HoleValues",
  "StyleBlock",
  "StyleEntry",
  "StyleMap",
  "StyleValue",
  "StyleVarValue",
];

/** Everything one module exports, values and types alike, through a real program. */
function exportsOf(entry: string): string[] {
  const program = ts.createProgram([entry], { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true });
  const file = program.getSourceFile(entry);
  if (file === undefined) throw new Error(`no source file for ${entry}`);

  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`${entry} is not a module`);

  return checker
    .getExportsOfModule(symbol)
    .map((one) => one.name)
    .sort();
}

const COMPILER = [
  "CssBlockError",
  "Sheet",
  "checkBlock",
  "checkSource",
  "checkText",
  "HASH_LENGTH",
  "HOLE",
  "MEDIA_FEATURES",
  "classNameFor",
  "findBlocks",
  "mayHoldABlock",
  "holeOutOfPlace",
  "normalise",
  "placehold",
  "positionOf",
  "readBlock",
  "substitute",
  "transform",
  "variableNameFor",
  "virtualFile",
];

describe("public API surface", () => {
  test("the runtime entry exports exactly what it means to", () => {
    expect(Object.keys(api).sort()).toEqual([...RUNTIME].sort());
  });

  test("the compiler entry exports exactly what it means to", () => {
    expect(Object.keys(compiler).sort()).toEqual([...COMPILER].sort());
  });

  test("and exactly the types it means to, which `Object.keys` cannot see", () => {
    const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

    expect(exportsOf(entry)).toEqual([...RUNTIME, ...TYPES].sort());
  });

  test("the runtime entry does not re-export the compiler", () => {
    // The class name is decided at build time. A runtime that could hash one would be a runtime that
    // could invent a rule, and no rule is ever created at runtime — see DESIGN.md, decision 7.
    for (const name of COMPILER) expect(api).not.toHaveProperty(name);
  });
});
