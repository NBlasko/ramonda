import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "element-tags", "tsconfig.json"));

/**
 * A tag that is a VALUE — `__h(node.t, …)` with the tag read from a parsed content tree, or
 * `<Heading>` with `Heading` chosen between `"h1"` and `"h2"`.
 *
 * A string tag is an element, never a component, so there is nothing to follow — and the TYPE says
 * so where the syntax does not. Read only from the syntax, the docs site's own code block was an
 * unresolved component and carried a `ramonda-check-ignore`: an ignore for a design that is right.
 * `any`, `unknown` and a union with a component prove nothing, and stay holes.
 */
describe("a tag whose type is a string", () => {
  test("is an element, in the factory and as a tag, and only a type that proves it is", () => {
    expect(run().unresolved.map((hole) => `${hole.what}:${hole.line}`)).toEqual([
      "factory:25",
      "factory:26",
      "factory:27",
    ]);
  });
});
