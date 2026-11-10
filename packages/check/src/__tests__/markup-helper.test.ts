import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "markup-helper", "tsconfig.json"));

/**
 * A function that returns markup, built inside `render()` and called there.
 *
 * Found by the second trial: nine column headings written as `const head = (key, cls) => <th …>` at the
 * top of `render()`, the everyday shape where a component is a function. Nothing broke and no rule
 * fired — `function-built-in-the-markup` is about a function HANDED to the markup, and this one is only
 * called — and the user found it in review. In a class it hides part of the rendering where a subclass,
 * a test and the devtools cannot reach it, and builds a new closure on every render.
 */
describe("a markup helper built inside render()", () => {
  const found = () => run().findings["markup-helper-in-render"];

  test("every shape that is only called is reported, with the name to make a method of", () => {
    expect(found().map((issue) => `${issue.component}: ${issue.helper}`)).toEqual([
      "Standings: head",
      "Shapes: badge",
      "Shapes: chip",
      "PerRow: cell",
      "RowsHelper: rowsOf",
    ]);
  });

  test.each([
    ["Handed", "a row callback is handed to `list` or `map`, inline or lifted"],
    ["Mixed", "a helper that is also handed over is the handed rule's"],
    ["Fixed", "a helper that returns no markup, and a method — the fix"],
    ["OtherMethod", "a closure in another method is not built on every render"],
    ["InAHandler", "one built inside a click handler is built per click, not per render"],
  ])("%s is silent — %s", (component) => {
    expect(found().filter((issue) => issue.component === component)).toEqual([]);
  });

  test("each is placed at its own declaration", () => {
    expect(found().map((issue) => issue.line)).toEqual([9, 24, 28, 46, 114]);
  });
});
