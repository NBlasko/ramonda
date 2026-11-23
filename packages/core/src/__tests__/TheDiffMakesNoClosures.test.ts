import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The functions the diff runs for every component and every level write no function inside them.
 *
 * A function written inside another is a closure, and V8 then keeps the outer function's variables in a
 * context object it makes on EVERY call — whether or not the inner function is ever reached. Measured in
 * Chrome, creating 1,000 rows of five components: `reconcileEntries` allocated 428 B per component with
 * its child walk written as an inner function, `buildComponent` 187 B with `atTopLevel(() => …)` and a
 * `@mounted` arrow in it; the walk inlined and the arrows moved into functions of their own took the
 * whole create from 1,869 to 1,531 B per component.
 *
 * Nothing at run time can see a context that was not made, so this reads the source: each function
 * named here holds no arrow, `function` or method of its own. A closure that has to exist goes in a
 * function of its own, called only on the path that needs it — `reconcileFromInsideALevel`,
 * `queueMounts`.
 */
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..", "core", "DiffAndMerge.ts");
const HOT = ["reconcileEntries", "reconcileAtTopLevel", "buildComponent"];

function functionsWrittenIn(name: string): string[] {
  const file = ts.createSourceFile(SOURCE, readFileSync(SOURCE, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  if (declaration?.body === undefined) throw new Error(`no function ${name} in DiffAndMerge.ts`);
  const found: string[] = [];
  (function walk(node: ts.Node): void {
    if (ts.isFunctionLike(node)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      found.push(`line ${line + 1}: ${node.getText().slice(0, 60)}`);
      return;
    }
    ts.forEachChild(node, walk);
  })(declaration.body);
  return found;
}

describe("the diff's per-component functions", () => {
  test.each(HOT)("%s writes no function inside it", (name) => {
    expect(functionsWrittenIn(name)).toEqual([]);
  });
});
