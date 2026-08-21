import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "listeners", "tsconfig.json"));
const found = () => run().findings["listener-added-by-hand"];
const by = (why: string) =>
  found()
    .filter((issue) => issue.why === why)
    .map((issue) => issue.component);

/**
 * A component reaching for `window.addEventListener` itself.
 *
 * `@onWindow` and `@onDocument` attach on mount and detach on unmount, so outside one specific
 * place there is nothing a hand-rolled listener buys. Nothing reported this before — measured, a
 * component calling it in `@created` AND in `render()` produced no findings at all, and no rule in
 * the package mentioned `addEventListener`.
 */
describe("a listener a component adds by hand", () => {
  test("the decorator is the answer, and that does not depend on cleanup or on the event's name", () => {
    expect(by("a decorator does it")).toEqual([
      "Leaks",
      "Leaks",
      "LeaksThroughAName",
      "LeaksPerRender",
      // Removed by hand in `@destroyed`, and still reported: a listener is not a timer, and the
      // decorator does both halves. `interval-with-no-cleanup` accepts the pair because there is
      // no `@interval` equivalent for every shape; here there is.
      "Paired",
      // `@onWindow` takes the same options, so `{ once: true }` and `{ signal }` are not answers.
      "ClosesItself",
      "ClosesItself",
      // An unreadable event name costs nothing: the decorator was the answer whatever it is called.
      "UnreadableEvent",
      // Reported at the base, where the call is written, rather than at every class extending it.
      "AddsOnABase",
      // Abstract excuses the CLEANUP question, not this one — who extends the class has no bearing
      // on whether a decorator would have done the job.
      "AbstractAdds",
      "NotReallyGuarded",
      "NotReallyGuarded",
    ]);
  });

  /**
   * The one place a decorator genuinely cannot be used, and the escape is a FACT rather than a
   * promise.
   *
   * A decorator is code on the class, so no `__DEV__` guard can remove it: a dev-only listener
   * written with `@onWindow` would attach in production too, for an event nothing dispatches.
   * Verified in `packages/query/dist/index.prod.js`, where the methods that add and remove one
   * compile to `publishToDevtools(){}` and the listener does not exist — while `@onWindow("online")`
   * on the `Query` hook is plainly there in the same file.
   *
   * So inside a guard the hand-rolled call is right, and only the ordinary question is left. This
   * matters beyond the rule: an annotation can be sprinkled to make a project's findings look
   * better, and a `__DEV__` block can only be got by making the code really vanish.
   */
  test("inside `if (__DEV__)` the hand-rolled call is right, and only the open hatch is reported", () => {
    expect(by("nothing removes it")).toEqual(["DevOnlyAndLeaking"]);
    expect(found().map((issue) => issue.component)).not.toContain("DevOnlyAndPaired");
    /**
     * Added on `window`, removed on `globalThis` — one object under two names, and the devtools
     * shape with one word changed. The removal set was keyed on the SPELLING, so this was reported.
     */
    expect(found().map((issue) => issue.component)).not.toContain("DevOnlyAcrossTwoNames");
    /**
     * The `&&` and the ternary spellings of the same guard. `packages/core` writes `__DEV__ &&`
     * thirteen times, and reading only the `if` reported the identical code written either of the
     * other two ways.
     */
    expect(found().map((issue) => issue.component)).not.toContain("DevOnlyWithAnAnd");
    expect(found().map((issue) => issue.component)).not.toContain("DevOnlyWithATernary");
  });

  /**
   * `__DEV__ || x` runs in production whenever `x` does, and the `else` of a dev guard IS the
   * production half. Neither is a guard, and both are reported.
   */
  test("an `||` is not a guard, and neither is the `else` of one", () => {
    expect(by("a decorator does it").filter((name) => name === "NotReallyGuarded")).toHaveLength(2);
  });

  /**
   * A render runs whenever the framework likes, so the same line registers a listener once per PASS
   * rather than once per mount — measured against the real runtime at 6 listeners over 6 renders.
   * The report says so, because it is not the same conversation.
   */
  test("a listener added in a render says that it happens again on every pass", () => {
    expect(
      found()
        .filter((issue) => issue.perRender)
        .map((issue) => issue.component),
    ).toEqual(["LeaksPerRender"]);
  });

  /**
   * What no decorator covers and what outlives nothing: an `AbortSignal` dies with its request, an
   * element with the element, and module scope lives as long as the module.
   */
  test("a listener on anything but window or document is not this rule's business", () => {
    const components = found().map((issue) => issue.component);

    expect(components).not.toContain("NotAGlobal");
    expect(found()).toHaveLength(13);
  });
});
