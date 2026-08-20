import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "mutation", "tsconfig.json"));

/**
 * A `@state` array or object changed in place — the static half of `RMD005` and `RMD048`.
 *
 * The runtime guard is a proxy over the value, so it sees the mutation happen. This sees the line
 * that would do it, and it mirrors the guard's two boundaries rather than inventing its own: only
 * plain objects and arrays, and only the mutating array methods. A rule drawing its own line would
 * disagree with the runtime about somebody's code, which is worse than either being narrow.
 */
describe("a state value changed in place", () => {
  test("every way of changing the held value is reported", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found.map((issue) => `${issue.field}:${issue.did}`)).toEqual([
      "items:push()",
      "user:`name` written",
      "items:an index written",
    ]);
  });

  /** The fix must never be reported: `map`, `filter`, `slice` and a spread all return a new value. */
  test("a non-mutating method and a replacement are left alone", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found).toHaveLength(3);
    expect(found.every((issue) => issue.member === "seed")).toBe(true);
  });

  /**
   * The guard wraps only plain objects and arrays — a `Date`, a `Map` or a class instance goes
   * through untouched, because their methods need the real receiver. So neither half reports
   * `this.when.setHours(0)`, and neither reports a field that is not state.
   */
  test("a value the runtime guard does not wrap is not reported either", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found.some((issue) => issue.field === "when" || issue.field === "plain")).toBe(false);
  });
});
