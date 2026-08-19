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
describe("a @compute over a plain field", () => {
  test("the field something writes after the first render is reported, and the writer named", () => {
    const found = run().findings["compute-reads-a-plain-field"];
    expect(found.map((issue) => `${issue.compute}:${issue.field}:${issue.writtenBy}`)).toEqual(["total:rate:start"]);
  });

  /**
   * Four kinds of write that cannot make a compute stale, each for its own reason: before the first
   * render (`@created`), after the last (`@destroyed`), from inside the compute (the memo pattern),
   * and never at all (a constant).
   */
  test("a write that cannot make anything stale is not reported", () => {
    const found = run().findings["compute-reads-a-plain-field"];
    const fields = found.map((issue) => issue.field);
    expect(fields).not.toContain("currency");
    expect(fields).not.toContain("closed");
    expect(fields).not.toContain("cached");
    expect(fields).not.toContain("prefix");
  });

  /** A hook and a function are read in computes constantly and are neither state nor stale. */
  test("a hook field and a function field are not plain fields", () => {
    const found = run().findings["compute-reads-a-plain-field"];
    expect(found.some((issue) => issue.field === "clock" || issue.field === "format")).toBe(false);
  });
});
