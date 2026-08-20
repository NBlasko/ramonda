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
      "Row.conf:object",
      "Row.conf:object",
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
      "chainConf() @ `level3`",
      "deepConf() @ `deep12`",
      "arrowConf() @ `arrowConf`",
      "maybeConf(true) @ `maybeConf`",
      "makeConf() as { dense: boolean } @ `makeConf`",
      '["new", "hot"]',
    ]);
  });

  /**
   * A helper calling a helper, which is what a real codebase looks like a refactor or two in.
   *
   * The NAME in the report is the one this pins: `chainConf()` is already on the line the reader is
   * looking at, so repeating it says nothing. `level3` is where the literal actually is, three hops
   * and one file away, and it is the only thing they cannot see from here.
   *
   * The arrow was a plain miss until it was planted — only the `function` form was followed, so
   * writing the same helper as `const makeConf = () => ({…})` silenced the rule completely.
   */
  test("a chain of helpers is followed, and the report names where the literal is", () => {
    const found = run().findings["fresh-object-in-props"];
    const byWritten = new Map(found.map((issue) => [issue.written, issue.builtIn]));

    expect(byWritten.get("chainConf()")).toBe("`level3`");
    expect(byWritten.get("arrowConf()")).toBe("`arrowConf`");
  });

  /** A cast changes the type and nothing else — the object is built at the same moment either way. */
  test("a cast does not hide it", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written).toContain("makeConf() as { dense: boolean }");
  });

  /**
   * The depth bound, pinned at twelve hops — further than anyone writes on purpose.
   *
   * A LOW bound looks careful and is not. Giving up after three hops means a chain of four helpers
   * is reported as nothing at all, and nothing is what a clean codebase looks like: the reader
   * cannot tell "checked and fine" from "gave up". Cost is not the reason to keep it low either —
   * a hop is one symbol resolve and one walk of one function body.
   */
  test("a twelve-deep chain is still followed to the literal", () => {
    const found = run().findings["fresh-object-in-props"];
    const deep = found.find((issue) => issue.written === "deepConf()");

    expect(deep?.builtIn).toBe("`deep12`");
  });

  /**
   * What actually stops a runaway is the CYCLE GUARD, not the depth. Two helpers calling each other
   * hand back no value at all, and the walk has to end on that rather than on the bound — this test
   * hangs the suite if the guard is ever dropped.
   */
  test("recursion terminates and reports nothing", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written).not.toContain("loopConf()");
    expect(written).not.toContain("chainShared()");
  });

  /**
   * A helper with two returns, one of them the held object. It is REPORTED, because the other path
   * really does build a fresh object and really does defeat comparison whenever it runs — and the
   * reader is sent to a line where the literal is plainly there to judge for themselves.
   */
  test("a helper that builds one on only one path is still reported", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written).toContain("maybeConf(true)");
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
    // Twenty elements in the fixture and nine reported, so a leak shows as a count.
    expect(found).toHaveLength(9);
  });
});
