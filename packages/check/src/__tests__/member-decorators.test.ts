import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "member-decorators", "tsconfig.json"));

/**
 * `RMD050` and `RMD047`, moved to where they can be said before anything runs.
 *
 * Both mirror the runtime rather than inventing a line: the capability table is the one
 * `debug/claimMember.ts` keeps, and a cache key holds a string, a number or a boolean because that
 * is what `describeUnkeyableArgs` decides by.
 */
describe("a decorator that adds nothing", () => {
  test("two different decorators giving one member the same thing are reported", () => {
    const found = run().findings["decorator-that-adds-nothing"];
    expect(found.map((issue) => `${issue.member}:${issue.adds} over ${issue.already}`)).toEqual([
      "both:persist over state",
    ]);
  });

  /**
   * The same decorator twice is `duplicate-decorators`' report. Found by building this rule and
   * watching both fire on one line — two reports on one line is how a reader learns to skim past.
   */
  test("the same decorator twice is left to the rule that already had it", () => {
    const found = run().findings["decorator-that-adds-nothing"];
    expect(found.some((issue) => issue.member === "twice")).toBe(false);
    expect(run().findings["duplicate-decorators"].some((issue) => issue.component === "Panel")).toBe(true);
  });

  /** Two decorators doing different work on one member is an idiom, and the runtime says nothing. */
  test("decorators that do different work are silent", () => {
    const found = run().findings["decorator-that-adds-nothing"];
    expect(found).toHaveLength(1);
  });
});

describe("a memoized handler that cannot be keyed", () => {
  test("a declaration that can never be keyed is reported once, at the declaration", () => {
    const found = run().findings["unkeyable-memoized-argument"];
    const declarations = found.filter((issue) => issue.where === "the declaration");
    expect(declarations.map((issue) => `${issue.member}:${issue.passed}`)).toEqual([
      "byObject:an object",
      "byArray:an array",
    ]);
  });

  test("a call with a provably unkeyable argument is reported, cast and all", () => {
    const found = run().findings["unkeyable-memoized-argument"];
    const calls = found.filter((issue) => issue.where === "a call");
    expect(calls.map((issue) => issue.passed)).toEqual(["an object", "null", "an object"]);
  });

  /**
   * The handler on a BASE, the call in the subclass — one instance, one cache.
   *
   * `this.pick({ id })` down here THROWS `RMD047` at runtime exactly as it would up there, and
   * matching calls against one class body missed every one of them.
   *
   * The DECLARATION half stays where it is written: a base's unkeyable parameter is reported once,
   * at the base, rather than again for every class extending it.
   */
  test("a call to a handler the BASE declares is reported, and the declaration is not doubled", () => {
    const found = run().findings["unkeyable-memoized-argument"];
    const inherited = found.filter((issue) => issue.component === "CallsTheBase");
    expect(inherited.map((issue) => `${issue.member}:${issue.where}`)).toEqual(["pick:a call"]);
    expect(found.filter((issue) => issue.where === "the declaration").map((issue) => issue.component)).toEqual([
      "Panel",
      "Panel",
    ]);
  });

  /**
   * The silence that makes it shippable: `this.pick(row.id)` is right and `this.pick(row)` is the
   * fault, and nothing here can tell them apart without asking for a type — which this package
   * does not do.
   */
  test("an argument this cannot read is left alone", () => {
    const found = run().findings["unkeyable-memoized-argument"];
    expect(found).toHaveLength(5);
  });
});
