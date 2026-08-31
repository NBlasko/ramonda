import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * `unserializable-state` — `RMD019` and `RMD033`, asked only where there is a blob to cross.
 *
 * The two fixtures are the SAME components. The only difference is one import, and that is the
 * whole rule: a `Map` in state is wrong when the server has to hand it to the client, and perfectly
 * correct when nothing ever does.
 *
 * The gate is a second `needs` rather than a check inside the rule, so a browser-only project does
 * not SKIP the rule — the rule is not part of that run at all, which is the honest shape and the
 * one the router rule already established.
 */
describe("a state value the hydration blob cannot carry", () => {
  test("is reported where something renders on a server", () => {
    const found = run("ssr-state").findings["unserializable-state"];
    expect(found.map((issue) => `${issue.field}:${issue.holds}`)).toEqual([
      "inherited:Maps",
      "byId:Maps",
      "meta:Dates",
      "cast:Maps",
      "shared:Maps",
      "fromHelper:Maps",
      "plantedLossy:Map",
      "deep:Maps",
      "held:Maps",
      "branched:Maps",
      "fallback:Dates",
      "wrapped:Maps",
      "started:Dates",
    ]);
  });

  /**
   * The same value one hop from the field, which is where a refactor leaves it.
   *
   * `lossyIn` follows a name, so this rule inherited the whole walk from the round that fixed
   * `persist-of-a-lossy-value` — a cast, a module `const`, a helper, a chain of three, a helper
   * handing back one it HOLDS, a ternary and a `??`. Planted rather than assumed: a rule that
   * reports nothing looks exactly like a clean codebase.
   */
  test("the value a name away is the same value in the blob", () => {
    const fields = run("ssr-state").findings["unserializable-state"].map((issue) => issue.field);

    for (const field of ["cast", "shared", "fromHelper", "deep", "held", "branched", "fallback"]) {
      expect(fields).toContain(field);
    }
  });

  /**
   * A `Map` behind a `@memoized` call, which is a report this rule nearly LOST.
   *
   * `fresh-object-in-props` was taught to stop at a caching method, because there `@memoized` is the
   * documented fix and following it reports the answer. Written into the walk itself, that made
   * every question stop — including this one, which is not about whether a value is rebuilt but
   * about what it IS. Caching changes nothing about what it is: a `Map` behind a cache is still a
   * `Map` the hydration blob cannot carry, and this rule is an ERROR going quiet on exactly the
   * value it exists for.
   *
   * Measured both ways before it was fixed, and pinned here because a lost report is invisible
   * afterwards in precisely the way a gap is. The axis is `Looking.throughMemoizedCalls`.
   */
  test("a lossy value behind a `@memoized` call is still lossy", () => {
    const fields = run("ssr-state").findings["unserializable-state"].map((issue) => `${issue.field}:${issue.holds}`);
    expect(fields).toContain("plantedLossy:Map");
  });

  /**
   * Where the value is built, when it is not on the line being reported — and the INNERMOST place.
   *
   * `@state deep = level1()` said it holds a `Maps` and gave the reader nowhere to go; `level1` is
   * already on the line they are looking at, so what they need is `level3`.
   */
  test("and the report says where it is built", () => {
    const where = new Map(
      run("ssr-state").findings["unserializable-state"].map((issue) => [issue.field, issue.foundIn]),
    );

    expect(where.get("deep")).toBe("`level3`");
    expect(where.get("fromHelper")).toBe("`makeCache`");
    expect(where.get("shared")).toBe("`SHARED`");
    /**
     * Two names deep, and the INNER one wins. `wrap()` hands back `{ cache: makeCache() }`, so
     * `wrap` is already on the line being read and `makeCache` is where the `Map` is. The walk's own
     * name was taken unconditionally and printed the first of the two.
     */
    expect(where.get("wrapped")).toBe("`makeCache`");
    // Written on the line itself, so there is nowhere else to send anybody.
    expect(where.get("byId")).toBeUndefined();
  });

  /** A base declares it, a subclass inherits it, and one report names the base. */
  test("a field a base declares is reported once, at the base", () => {
    const found = run("ssr-state").findings["unserializable-state"].filter((issue) => issue.field === "inherited");

    expect(found).toHaveLength(1);
    expect(found[0].component).toBe("Storefront");
  });

  /** A field with no `@state`, and a `@compute`, are in no blob and are not asked about. */
  test("what is not state is not reported", () => {
    const fields = run("ssr-state").findings["unserializable-state"].map((issue) => issue.field);

    expect(fields).not.toContain("notState");
    expect(fields).not.toContain("derived");
    expect(fields).not.toContain("total");
  });

  /**
   * The same state, one import fewer, and nothing to say about any of it — including the values a
   * name away, because the gate is about the PROJECT and not about how the value was spelled.
   */
  test("is not asked at all in a browser-only project", () => {
    expect(run("spa-state").findings["unserializable-state"]).toEqual([]);
  });

  /**
   * `@persist` says the field is meant to travel whatever the project does about servers, so the
   * ungated rule answers it — and two reports on one line is how a reader learns to skim past both.
   */
  test("a field that is also `@persist` is left to the rule with no gate", () => {
    const findings = run("ssr-state").findings;
    expect(findings["unserializable-state"].some((issue) => issue.field === "both")).toBe(false);
    expect(findings["persist-of-a-lossy-value"].some((issue) => issue.field === "both")).toBe(true);
  });
});
