import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "fresh-props", "tsconfig.json"));

/** The 1-based line an element's label sits on, so a test can name a site rather than an index. */
const lineOf = (label: string) => {
  const source = readFileSync(join(here, "fixtures", "fresh-props", "app.tsx"), "utf8").split("\n");
  const at = source.findIndex((line) => line.includes(label));
  if (at < 0) throw new Error(`no line in the fixture holds ${label}`);
  return at + 1;
};

/**
 * A literal written into a component's props.
 *
 * Measured before the rule was written, by counting a child's renders: with `conf={{ a: 1 }}` the
 * child goes from one render to two when its parent re-renders for an unrelated reason, and with
 * the same object passed each time it stays at one. So it is the literal and nothing else.
 */
describe("a prop rebuilt on every render", () => {
  test("an object and an array literal are both reported, and nothing else is", () => {
    const found = run().findings["fresh-object-in-props"];

    // A tally rather than a list: every entry names the same component and prop, so a list of them
    // would say nothing that the ledger below does not say better.
    expect(found.filter((issue) => issue.kind === "array").map((issue) => issue.prop)).toEqual(["tags"]);
    expect(found.every((issue) => issue.component === "Row")).toBe(true);
  });

  /**
   * The literal is the shape people write first, and it is not the one that survives a refactor.
   * Both of these were planted and both were silent: moving the object one line up, and moving it
   * into a helper in another file, are the same object built at the same moment.
   *
   * The report quotes what is on the LINE and names where the value comes from, because calling
   * `conf={local}` a `conf={{…}}` sends a reader looking for a brace that is not there.
   */
  /**
   * The per-row answer this report itself recommends, and it was REPORTED until the documentation
   * found it: `concepts/caching.md` teaches `cfg={this.configFor(row.id)}` as the fix for exactly
   * this finding, and running the rules over the docs' own examples reported the page teaching the
   * answer. `@compute` was skipped here from the start; `@memoized` was not, and it is the one that
   * works per ROW.
   *
   * Kept as a test because a silence is a decision, and a decision with no test is one somebody
   * undoes.
   */
  test("a `@memoized` call is the fix, and is not reported", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written).not.toContain('this.configFor("a")');
  });

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
      "{ dense: true }",
      "perRow @ `perRow`",
      "{ dense: true }",
      "{ dense: true }",
      '["new", "hot"]',
      "this.dense ? { dense: true } …",
      "this.dense ? { dense: true } …",
      "this.maybe ?? { dense: true }",
      "{ dense: true }",
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
   * A literal inside a `map` or a `list` callback — the same fault at the scale that hurts, since
   * it is one child per row that can never be skipped.
   *
   * It is reported in DIFFERENT words, because the fix is different: a value derived from the row
   * cannot be lifted to a constant, and telling someone to do that is telling them nothing. The row
   * itself is as stable as the array holding it and stays silent.
   */
  test("a literal per row says so, and the row itself is silent", () => {
    const found = run().findings["fresh-object-in-props"];
    const rows = found.filter((issue) => issue.perRow);

    expect(rows.map((issue) => issue.written)).toEqual(["{ dense: true }", "perRow"]);
    expect(found.map((issue) => issue.written)).not.toContain("row");
    expect(found.map((issue) => issue.written)).not.toContain("row.conf");
  });

  /**
   * A branch builds on the path it takes, and that path is the fault. `conf={this.conf ?? {…}}` is
   * the shape that matters most — a fallback default is written constantly, and it hands the child
   * a fresh object on every render where the left is missing.
   */
  test("a ternary arm and a `??` fallback are both reported", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written.filter((one) => one.startsWith("this.dense ?"))).toHaveLength(2);
    expect(written).toContain("this.maybe ?? { dense: true }");
  });

  /**
   * A spread, which every other element rule treats as a reason to say nothing at all.
   *
   * That silence is about an attribute that is MISSING — `<img {...rest} />` may well carry its
   * `alt`. It does not transfer here: a spread cannot un-build an object literal written beside it.
   * What it CAN do is overwrite it, so order decides. Before the last spread the prop may never
   * reach the child and this stays quiet; after it, nothing can take it away.
   */
  test("a literal after the last spread is reported, and one before it is not", () => {
    const found = run().findings["fresh-object-in-props"];
    const onLine = (label: string) => found.filter((issue) => issue.line === lineOf(label)).length;

    expect(onLine('label="g"')).toBe(1);
    expect(onLine('label="f"')).toBe(0);
  });

  /**
   * Children, and a node handed over as a prop.
   *
   * Both are rebuilt every render and both really do defeat comparison — `ChildrenAreProps.test.tsx`
   * in core measures four renders where a childless component has one. Neither is reported, because
   * every composed element on the page is this: a rule that reported them would report the whole
   * app, and the fix is a decision about the component rather than about the call site.
   *
   * The literal INSIDE either one is still reported, because that one is a choice. Both nested
   * `conf` literals below are among the findings.
   */
  test("children and a node as a prop are silent, but a literal inside one is not", () => {
    const found = run().findings["fresh-object-in-props"];
    const on = (label: string) => found.filter((issue) => issue.line === lineOf(label));

    // One finding on the line, and it is the INNER `conf` — the outer prop holding the whole
    // element is silent, or its `written` would start with a `<`.
    expect(on('label="vnode"').map((issue) => issue.written)).toEqual(["{ dense: true }"]);
    // The element with children is silent; the element written inside it is not.
    expect(on('label="kids"')).toEqual([]);
    expect(on('label="nested"').map((issue) => issue.written)).toEqual(["{ dense: true }"]);
  });

  /**
   * A `@compute` reached through a CALL.
   *
   * Planted when main made both forms readable: a `@compute` method now installs a function that
   * returns the cached value, so `conf={this.settings()}` is a supported way to write it — and a
   * walk that followed the call would find the literal inside the getter and report the cache
   * itself. Proved by removing the decorator, which takes the fixture from seventeen findings to
   * eighteen: the guard is what does the work here, not a resolve that quietly failed.
   */
  test("a @compute method called in a prop is silent", () => {
    const written = run().findings["fresh-object-in-props"].map((issue) => issue.written);
    expect(written).not.toContain("this.settings()");
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
    // Thirty-three elements in the fixture and seventeen reported, so a leak shows as a count.
    expect(found).toHaveLength(17);
  });
});
