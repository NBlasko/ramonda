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
   * A render that ARMS a write is the fault, not an exception to it — measured, twice.
   *
   * This was narrowed to an allowlist of calls that run what they are handed, on the argument that
   * `setTimeout(() => { this.n = 1 }, 0)` does not write state DURING the render. True about the
   * moment, false about the fault:
   *
   * - the write armed from a render, guarded to stop at 50, renders **51 times**; unguarded it does
   *   not stop. That is this rule's own sentence — "a render that schedules a render" — reached
   *   exactly, and the narrowing made it silent.
   * - `window.addEventListener("resize", …)` in a render registers **6 listeners over 6 renders**,
   *   none removed.
   *
   * Both measured against the real runtime in `@ramonda/core` before this was put back.
   */
  test("a render that arms a deferred write is reported", () => {
    const found = run().findings["state-written-while-rendering"];

    expect(found.map((issue) => issue.component)).toEqual([
      "Direct",
      "Deferred",
      "Deferred",
      "Deferred",
      "Deferred",
      "Immediate",
    ]);
    for (const line of [35, 38, 41, 44]) expect(found.map((issue) => issue.line)).toContain(line);
  });

  /**
   * The shape the walk really does have to leave alone, and it is not a call argument at all.
   *
   * A function RETURNED — `@memoized finish(id) { return () => { this.todo = … } }` — or written
   * as a JSX attribute is a handler, and writing state in one is the whole point of it. Neither is
   * an argument to a call, so nothing about the handler case needs a narrowing here.
   */
  test("a row builder, which really does run now, is reported too", () => {
    const found = run().findings["state-written-while-rendering"];

    expect(found.map((issue) => issue.line)).toContain(61);
  });

  /** What already held: the render's own body, and a `@compute` written as a method. */
  test("a clock is found in the render and in a `@compute` method", () => {
    const found = run().findings["clock-read-while-rendering"];

    expect(found.map((issue) => `${issue.component}:${issue.through.join(" → ")}`)).toContain("Direct:render");
    expect(found.map((issue) => `${issue.component}:${issue.through.join(" → ")}`)).toContain("ComputedMethod:stamp");
  });
});
