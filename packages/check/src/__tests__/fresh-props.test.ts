import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "fresh-props", "tsconfig.json"));

/**
 * A literal written into a component's props.
 *
 * Measured before the rule was written, by counting a child's renders: with `conf={{ a: 1 }}` the
 * child goes from one render to two when its parent re-renders for an unrelated reason, and with
 * the same object passed each time it stays at one. So it is the literal and nothing else.
 */
describe("a prop rebuilt on every render", () => {
  test("an object and an array literal are both reported", () => {
    const found = run().findings["fresh-object-in-props"];
    expect(found.map((issue) => `${issue.component}.${issue.prop}:${issue.kind}`)).toEqual([
      "Row.conf:object",
      "Row.tags:array",
    ]);
  });

  /**
   * A prop the component DECLARED with `@StableProps` is not this fault — the declaration is the
   * answer to this report, so reporting it would be reporting the fix. The framework compares that
   * prop by content and hands the child back the identity it already had, which is why `RMD020`
   * skips it at runtime for the same reason.
   *
   * The declaration is resolved through the checker rather than matched by name, and read through
   * the class chain, because `@StableProps` merges along it.
   */
  test("a declared prop is not reported, on the class or on one that inherits it", () => {
    const components = run().findings["fresh-object-in-props"].map((issue) => issue.component);
    expect(components).not.toContain("Settled");
    expect(components).not.toContain("SettledBase");
    expect(components).toContain("Row");
  });

  /**
   * The exclusion that decides whether this is shippable: `<div style={{ color: "red" }}>` is
   * written constantly and is not this fault — a host element hands nothing to a component, so
   * there is no comparison to defeat.
   */
  test("a literal on a host element is not reported", () => {
    const found = run().findings["fresh-object-in-props"];
    expect(found.some((issue) => issue.component === "div")).toBe(false);
    expect(found.some((issue) => issue.prop === "style" || issue.prop === "data-x")).toBe(false);
  });

  test("a stable object, a @compute and a spread are all silent", () => {
    const found = run().findings["fresh-object-in-props"];
    // Seven elements in the fixture and two reported, so a leak shows as a count.
    expect(found).toHaveLength(2);
  });
});
