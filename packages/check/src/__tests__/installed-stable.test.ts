import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * `@StableProps` across a package boundary.
 *
 * A `.d.ts` carries no decorators, so an app could not see what an installed package declared a
 * value — `@ramonda/query` declares `key` on `Query`. The two rules that read it went wrong in
 * opposite directions: `fresh-object-in-hook-props` stayed silent on every installed hook, so an
 * object rebuilt in `Query`'s props was never reported, and `fresh-object-in-props` reported an
 * installed component's declared prop as if nothing declared it. The package's graph carries the
 * declaration now, and both rules read it.
 */
describe("a package's @StableProps, read from its graph", () => {
  test("the package writes each declaration into its graph", () => {
    const nodes = run("vendor-hooks").graph.nodes;
    const declared = Object.fromEntries(nodes.map((node) => [node.name, node.stableProps ?? []]));
    expect(declared).toEqual({ Fetching: ["key"], Grid: ["conf"], Plain: [], Table: [] });
  });

  test("an installed hook is judged: the declared key is settled, the rest is reported", () => {
    const found = run("installed-stable").findings["fresh-object-in-hook-props"];
    expect(found.map((issue) => `${issue.hook}.${issue.prop}`)).toEqual(["Fetching.conf", "Plain.conf"]);
  });

  test("an installed component's declared prop is not reported, and an undeclared one is", () => {
    const found = run("installed-stable").findings["fresh-object-in-props"];
    expect(found.map((issue) => `${issue.component}.${issue.prop}`)).toEqual(["Table.conf"]);
  });
});
