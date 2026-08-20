import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "compute-field", "tsconfig.json"));

/**
 * A `@compute` holding a value that is simply wrong.
 *
 * Measured before the rule was written, by running it: with `@state tick`, a plain `rate` and
 * `@compute get total() { return this.tick * this.rate }`, setting `rate = 100` and then forcing a
 * render through UNRELATED state leaves `total` showing the answer from before. The page renders,
 * everything else on it updates, and one number is wrong.
 *
 * The silence half matters more here than in most rules: a plain field read by a compute is a very
 * common CORRECT shape, so the write is what makes it a fault.
 */
describe("a cached read of a plain field", () => {
  test("the field something writes after the first render is reported, and the writer named", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    expect(found.map((issue) => `${issue.named}:${issue.field}:${issue.writtenBy}`)).toEqual([
      "total:rate:start",
      "form:rate:start",
      "total:rate:bump",
      "total:rate:bump",
    ]);
  });

  /**
   * The read one hop away: the `@compute` calls a method of its own, and the METHOD reads the plain
   * field. The cache is stale in exactly the same way — a compute tracks the signals read while it
   * evaluated, wherever they were read — and reading only the compute's own body missed it.
   *
   * `this.` only. A free function has no `this`, so there is no field of this component's for it to
   * read, which is what keeps the hop bounded.
   */
  test("a plain field read through a method the compute calls is reported", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    const hop = found.filter((issue) => issue.component === "OneHopAway");
    expect(hop.map((issue) => `${issue.named}:${issue.field}`)).toEqual(["total:rate"]);
  });

  /**
   * The field on a BASE, the write and the cached read on the subclass — one instance, one stale
   * cache. Both halves of this rule read a single class body, so a shared base holding the field
   * made the whole fault invisible. Upward only: a base cannot know who extends it, so a `@compute`
   * on a base reading a field the subclass writes is out of reach and out of the claim.
   */
  test("a plain field inherited from a base goes stale the same way", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    const mine = found.filter((issue) => issue.component === "Priced");
    expect(mine.map((issue) => `${issue.named}:${issue.field}`)).toEqual(["total:rate"]);
  });

  /** `@state` on the base is tracked, and the chain is what says so. */
  test("state declared on a base is not a plain field", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    expect(found.some((issue) => issue.field === "open")).toBe(false);
  });

  /**
   * Two cached readers, one fault. A hook's props callback is cached on the signals it reads exactly
   * as a `@compute` is, so an ordinary field goes stale in both — which is why this is one rule and
   * not two copies of every judgement in it.
   */
  test("both kinds of reader are named for what they are", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    expect(found.map((issue) => issue.reader)).toEqual([
      "a `@compute`",
      "a props callback",
      "a `@compute`",
      "a `@compute`",
    ]);
  });

  /**
   * Four kinds of write that cannot make a compute stale, each for its own reason: before the first
   * render (`@created`), after the last (`@destroyed`), from inside the compute (the memo pattern),
   * and never at all (a constant).
   */
  test("a write that cannot make anything stale is not reported", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    const fields = found.map((issue) => issue.field);
    expect(fields).not.toContain("currency");
    expect(fields).not.toContain("closed");
    expect(fields).not.toContain("cached");
    expect(fields).not.toContain("prefix");
  });

  /** A hook and a function are read in computes constantly and are neither state nor stale. */
  test("a hook field and a function field are not plain fields", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    expect(found.some((issue) => issue.field === "clock" || issue.field === "format")).toBe(false);
  });
});
