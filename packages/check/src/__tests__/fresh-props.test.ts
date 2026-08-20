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
      "Row.conf:object",
      "Row.conf:object",
      "Row.tags:array",
    ]);
  });

  /**
   * The literal is the shape people write first, and it is not the one that survives a refactor.
   * Both of these were planted and both were silent: moving the object one line up, and moving it
   * into a helper in another file, are the same object built at the same moment.
   *
   * The report quotes what is on the LINE and names where the value comes from, because calling
   * `conf={local}` a `conf={{…}}` sends a reader looking for a brace that is not there.
   */
  test("a local one line up and a helper in another file are the same fault", () => {
    const found = run().findings["fresh-object-in-props"];
    expect(found.map((issue) => `${issue.written}${issue.builtIn ? ` @ ${issue.builtIn}` : ""}`)).toEqual([
      "{ dense: true }",
      "local @ `local`",
      "makeConf() @ `makeConf`",
      '["new", "hot"]',
    ]);
  });

  /**
   * The two silences that keep the hop provable. A MODULE-level const is built once — that is the
   * documented fix — and a helper handing back an object it holds is a stable reference. Reporting
   * either would be reporting the fix.
   */
  test("a module const and a helper that hands one back are both silent", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written).not.toContain("STABLE");
    expect(written).not.toContain("sharedConf()");
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
    // Eleven elements in the fixture and four reported, so a leak shows as a count.
    expect(found).toHaveLength(4);
  });
});
