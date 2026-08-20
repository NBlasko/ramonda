import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "fresh-selector", "tsconfig.json"));

/**
 * A `@watchProp` selector that BUILDS what it returns.
 *
 * Measured in core before the rule was written, with two watchers on one child while an unrelated
 * prop moved three times: `(p) => p.q` fired zero times and `(p) => ({ q: p.q })` fired three, and
 * `q` never changed once. The framework compares with `Object.is`, so a built value can only ever
 * answer "different".
 */
describe("a selector that can never match", () => {
  test("an object, an array, and one built by a helper are all reported", () => {
    const found = run().findings["fresh-value-from-a-watch-selector"];

    expect(found.map((issue) => `${issue.method}:${issue.kind} ${issue.written}`)).toEqual([
      "fresh:object ({ q: p.q })",
      "freshArray:array [p.q, p.page]",
      "second:object ({ page: p.page })",
      "viaHelper:object keyOf(p.q)",
    ]);
  });

  /**
   * With more than one selector the report has to say WHICH, because the method names none of them
   * — `previous[i] === next[i]` is how a reader tells them apart, and an index is what they count.
   */
  test("the report names which selector when there is more than one", () => {
    const second = run().findings["fresh-value-from-a-watch-selector"].find((issue) => issue.method === "second");

    expect(second?.selector).toBe(2);
    expect(second?.selectors).toBe(2);
  });

  /**
   * The silence that keeps this from being "a literal near a decorator": a selector that READS an
   * object hands back whatever the parent gave it. If that prop is rebuilt, `fresh-object-in-props`
   * reports it at the call site, which is where the fix belongs.
   */
  test("reading an object prop, or a helper handing one back, is silent", () => {
    const methods = run().findings["fresh-value-from-a-watch-selector"].map((issue) => issue.method);

    expect(methods).not.toContain("reads");
    expect(methods).not.toContain("viaHeld");
    expect(methods).not.toContain("plain");
    expect(methods).not.toContain("two");
  });

  /** It is an ERROR, not a warning: a `@watchProp` body refetches and resets, so firing it is wrong. */
  test("it is an error", () => {
    const found = run().findings["fresh-value-from-a-watch-selector"];
    expect(found).toHaveLength(4);
  });
});
