import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const at = join(here, "fixtures", "handler-in-the-markup");
const run = () => analyzeProject(join(at, "tsconfig.json"));
const found = () => run().findings["function-built-in-the-markup"];

/**
 * The 1-based line a labelled element sits on, so a test names a SITE rather than an index.
 *
 * A number written into an expectation goes stale silently — the fixture moves and the assertion
 * then names a brace while still passing — so every line in here is read off the file by its label.
 */
const lineOf = (label: string) => {
  const source = readFileSync(join(at, "app.tsx"), "utf8").split("\n");
  const found = source.findIndex((line) => line.includes(label));
  if (found < 0) throw new Error(`no line in the fixture holds ${label}`);
  return found + 1;
};

/**
 * A function literal written into a JSX attribute.
 *
 * Measured before the rule was written, on the element itself: `<button onclick={() => this.n} />`
 * under a component whose state changes makes 3 `addEventListener` and 3 `removeEventListener`
 * calls over three re-renders — one pair per render. So the churn the report names is real, and it
 * is the identity and nothing else.
 */
describe("a function built in the markup", () => {
  /**
   * The literal is the shape people write first, and it is not the one that survives a refactor.
   * A local one line up, a `let`, a cast, a ternary arm and a `??` fallback are all the same
   * function built at the same moment.
   *
   * `toEqual` on the whole list rather than a `not.toContain` per silent line: a negative
   * assertion keeps passing once the fixture moves under it, and says nothing while looking as
   * though it does.
   */
  test("every way of writing one is reported, and nothing else is", () => {
    expect(found().map((issue) => issue.line)).toEqual([
      lineOf("written in place"),
      lineOf("a local one line up"),
      lineOf("a let, reassigned"),
      lineOf("behind a cast"),
      lineOf("a ternary arm"),
      lineOf("a fallback"),
      lineOf("a function expression"),
      lineOf("{...rest} onclick={() => this.save()}"),
      lineOf("the verbatim spelling"),
      lineOf("a function in a non-event attribute"),
      lineOf('label="a component prop"'),
      lineOf("onclick={() => this.pick(row)}"),
    ]);
  });

  /**
   * The report quotes the LINE, and names where the function comes from when that is somewhere
   * else — calling `onclick={local}` an `onclick={() => …}` sends a reader looking for an arrow
   * that is not there.
   */
  test("the report quotes what is written and names where it was built", () => {
    const written = found().map((issue) => `${issue.written}${issue.builtIn ? ` @ ${issue.builtIn}` : ""}`);
    expect(written.slice(0, 3)).toEqual(["() => this.save()", "local @ `local`", "mutable @ `mutable`"]);
  });

  /**
   * A host element and a component are the same fault and NOT the same sentence: one is a listener
   * the diff removes and re-adds, the other is a prop a child cannot compare equal. Its sibling
   * `fresh-object-in-props` skips host elements entirely, because a host hands nothing to a
   * component — this rule must not, since a listener on a real node is most of the fault.
   */
  test("a host element and a component are told apart", () => {
    const byOwner = new Map(found().map((issue) => [issue.line, issue.on]));
    expect(byOwner.get(lineOf("written in place"))).toBe("element");
    expect(byOwner.get(lineOf('label="a component prop"'))).toBe("component");
  });

  /**
   * The report says which of FOUR things the fresh identity costs, and the fourth had no plant
   * until this file was reviewed: a function in a non-event attribute on a host element has no
   * listener to churn, so "the listener is removed and re-added" would be inventing one.
   */
  test("a host element with no event to name says what actually happens", () => {
    const issue = found().find((one) => one.line === lineOf("a function in a non-event attribute"));
    expect(issue?.on).toBe("element");
    expect(issue?.event).toBeUndefined();
  });

  /** Both spellings of an event name are the framework's own, and both are handlers. */
  test("the verbatim `on:` spelling is read as the event it names", () => {
    const issue = found().find((one) => one.line === lineOf("the verbatim spelling"));
    expect(issue?.event).toBe("my-event");
    expect(found().find((one) => one.line === lineOf("written in place"))?.event).toBe("click");
  });

  /**
   * Inside a `list` it is the same fault at the scale that hurts, and not the same advice: a
   * handler that closes over the row cannot be lifted out of the render.
   */
  test("a handler built per row says so", () => {
    const perRow = found().filter((issue) => issue.perRow);
    expect(perRow.map((issue) => issue.line)).toEqual([lineOf("onclick={() => this.pick(row)}")]);
  });

  /**
   * A CALL is never followed, and that is the rule's most important silence rather than a gap.
   * `@memoized` caches by its arguments per instance and `debounce` has nowhere else to live, so
   * following either would find the arrow inside and report the fix.
   */
  test("a call is never followed, however it is written", () => {
    const lines = found().map((issue) => issue.line);
    for (const label of [
      "a memoized call",
      "a call that wraps",
      "a call that builds one",
      "a call that hands back a held one",
      "mutual recursion",
    ]) {
      expect(lines).not.toContain(lineOf(label));
    }
    // The negative assertions above cannot go stale unnoticed while this holds the total.
    expect(lines).toHaveLength(12);
  });
});
