import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "render-reach", "tsconfig.json"));

/**
 * The walk most of the class family reads through, taken through the checklist.
 *
 * The two halves of a rule disagreed here, and the PROSE was the correct one: `runsNow` is
 * documented as "an argument to a call, which is `list(each, …)`, `.map(…)`, `.filter(…)` and their
 * family", and the code accepted an argument to ANY call.
 */
describe("what a render really reaches", () => {
  /**
   * A FALSE REPORT, four times over, and on the ordinary way to write each of them.
   *
   * None of these callbacks runs during the render: `setTimeout` fires after it, a `then` runs on a
   * microtask after it, and a listener runs when somebody clicks. Writing state in any of them is
   * correct, and it was reported as a write during the render.
   */
  test("a callback handed to something that defers is not part of the render", () => {
    const found = run().findings["state-written-while-rendering"];

    expect(found.map((issue) => issue.component)).toEqual(["Direct", "Immediate"]);
    for (const line of [29, 32, 35, 38]) expect(found.map((issue) => issue.line)).not.toContain(line);
  });

  /** And the one that really does run now still is: a row builder runs where the list sits. */
  test("a callback something invokes immediately is still part of the render", () => {
    const found = run().findings["state-written-while-rendering"];

    expect(found.map((issue) => issue.line)).toContain(50);
  });

  /**
   * The `@Host` props callback runs during the render and is in no member body, so `entryPoints`
   * did not reach it — a clock read there was invisible.
   *
   * Walked with `insideTheClass` FALSE, exactly as a static is: the callback is handed the
   * component as a PARAMETER rather than through `this`, so nothing about `this` is knowable in it
   * and only the reads that depend on nothing are worth finding.
   */
  test("the `@Host` props callback is part of the render too", () => {
    const found = run().findings["clock-read-while-rendering"];

    expect(found.map((issue) => issue.component)).toContain("HostProps");
    expect(found.find((issue) => issue.component === "HostProps")?.through).toEqual(["@Host props"]);
  });

  /** What already held: the render's own body, and a `@compute` written as a method. */
  test("a clock is found in the render and in a `@compute` method", () => {
    const found = run().findings["clock-read-while-rendering"];

    expect(found.map((issue) => `${issue.component}:${issue.through.join(" → ")}`)).toContain("Direct:render");
    expect(found.map((issue) => `${issue.component}:${issue.through.join(" → ")}`)).toContain("ComputedMethod:stamp");
  });
});
