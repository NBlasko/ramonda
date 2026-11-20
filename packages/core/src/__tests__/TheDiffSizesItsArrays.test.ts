import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The arrays the diff builds per level are made as long as they will be, and never grown with `push`.
 *
 * An array grown from `[]` reserves 17 slots on its first `push`, whatever it ends up holding, and the
 * diff keeps these: a level's entries are its region's record and its element's. Measured in Chrome
 * after creating 1,000 rows of five components: the records held 38,196 slots for 6,007 entries, the
 * normalized children 15,160 for 5,182 — about 83 B per component of slots nothing used. Sized from the
 * start, a component kept 754 → 644 B.
 *
 * What an array reserved cannot be read from JavaScript, so this reads the source: each array named here
 * is made with `new Array(<length>)` and written by index.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SIZED: [fn: string, array: string, file: string, length: string][] = [
  ["reconcileEntries", "entries", "core/DiffAndMerge.ts", "children.length"],
  ["normalizeChildren", "result", "vdom/h.ts", "arr.length"],
];

function arrayIn(file: string, fn: string, array: string): { made: string; pushes: number } {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === fn,
  );
  if (declaration?.body === undefined) throw new Error(`no function ${fn} in ${file}`);
  let made = "";
  let pushes = 0;
  (function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === array) {
      made = node.initializer?.getText() ?? "";
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      node.expression.expression.getText() === array
    ) {
      pushes++;
    }
    ts.forEachChild(node, walk);
  })(declaration.body);
  return { made, pushes };
}

describe("the arrays the diff keeps", () => {
  test.each(SIZED)("%s's `%s` in %s is made as long as it will be", (fn, array, file, length) => {
    expect(arrayIn(join(HERE, "..", file), fn, array)).toEqual({ made: `new Array(${length})`, pushes: 0 });
  });
});
