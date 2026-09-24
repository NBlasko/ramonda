import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import * as submodule from "../devtools";

/**
 * The `./devtools` entry, which the panel imports and an application does not.
 *
 * A second entry is a second public surface and `Object.keys` on the main one cannot see it — the
 * same reason `BguardSurface.test.ts` sits beside `PublicSurface.test.ts`. This entry had neither.
 *
 * **Its whole runtime job is a side effect**, which is why the first assertion is that it exports
 * nothing at all: importing the module registers the Forms tab with `panelRegistry`, and `Form`
 * announces itself with an event so the dependency points one way. A runtime export appearing here
 * would mean that seam had grown a second shape, which is exactly what this is for.
 *
 * So the list is TYPES, and `Object.keys` cannot see one. It is read from source instead.
 */
const TYPES = ["InspectableForm"];

function exportsOf(entry: string): string[] {
  const program = ts.createProgram([entry], { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true });
  const file = program.getSourceFile(entry);
  if (file === undefined) throw new Error(`no source file for ${entry}`);
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`${entry} is not a module`);
  return checker
    .getExportsOfModule(symbol)
    .map((each) => each.getName())
    .sort();
}

describe("the devtools entry", () => {
  test("carries nothing at run time — importing it IS the registration", () => {
    expect(Object.keys(submodule)).toEqual([]);
  });

  test("and exports exactly the types it means to", () => {
    const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "devtools.ts");

    expect(exportsOf(entry)).toEqual([...TYPES].sort());
  });
});
