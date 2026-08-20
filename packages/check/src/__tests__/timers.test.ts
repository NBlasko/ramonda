import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "timers", "tsconfig.json"));

/**
 * `RMD006`, moved to before the component ever mounts.
 *
 * An interval does not stop by itself, so an uncleared one is certain rather than likely — which is
 * the whole reason this rule is about `setInterval` and not about timers. A `setTimeout` stops on
 * its own, and telling a long one from a short one is a judgement about a number.
 */
describe("an interval nothing clears", () => {
  test("the three ways of losing the id are reported, each named", () => {
    const found = run().findings["interval-with-no-cleanup"];
    expect(found.map((issue) => `${issue.kept}:${issue.named ?? "-"}`)).toEqual([
      "nowhere:-",
      "a local:id",
      "a property:tick",
      // The fourth is `SameName`'s, asserted on its own below.
      "a property:id",
      // The fifth is the abstract base's LOCAL — see the chain tests at the bottom.
      "a local:local",
    ]);
  });

  /**
   * The heritage chain, and it is walked in one direction only.
   *
   * Upward it is read: a base's `@destroyed stop() { clearInterval(this.handle) }` clears an
   * interval its subclass started, on the same instance. Reading one class body reported that pair.
   *
   * Downward there is nothing to read — a class does not know who extends it. So an ABSTRACT class
   * keeping an id on a property goes quiet: it is never mounted on its own, and any subclass may be
   * the one clearing it, which makes the report a guess. A local is certain either way.
   */
  test("a base that clears what a subclass started is silent", () => {
    const found = run().findings["interval-with-no-cleanup"];
    expect(found.some((issue) => issue.component === "StartsBelow")).toBe(false);
  });

  test("an abstract base keeps its report for a local and loses it for a property", () => {
    const found = run().findings["interval-with-no-cleanup"];
    const mine = found.filter((issue) => issue.component === "StartsAbove");
    expect(mine.map((issue) => `${issue.kept}:${issue.named ?? "-"}`)).toEqual(["a local:local"]);
  });

  /** The documented shape — a property `@destroyed` clears — must never be reported. */
  test("a property something clears, and the decorator, are both silent", () => {
    const found = run().findings["interval-with-no-cleanup"];
    expect(found.some((issue) => issue.named === "kept")).toBe(false);
    expect(found).toHaveLength(5);
  });

  /**
   * `setTimeout` is not this rule's subject, and that is a decision rather than an oversight: an
   * uncleared `setTimeout(fn, 0)` is the commonest correct line of asynchronous code there is.
   */
  test("a timeout is not reported", () => {
    const found = run().findings["interval-with-no-cleanup"];
    expect(found.every((issue) => issue.member === "start")).toBe(true);
    expect(found.some((issue) => issue.kept === "nowhere" && issue.component === "Ticker")).toBe(true);
  });

  /** A local cleared in the same function is still reachable, so it is not the fault. */
  test("an interval cleared where it was made is left alone", () => {
    const found = run().findings["interval-with-no-cleanup"];
    expect(found.some((issue) => issue.component === "Once")).toBe(false);
  });

  /**
   * A property and a local of the same name are kept apart, so the local's `clearInterval` cannot
   * silence the property. One set for both would have made this a miss nobody would ever find.
   */
  test("a local does not answer for a property of the same name", () => {
    const found = run().findings["interval-with-no-cleanup"];
    const sameName = found.filter((issue) => issue.component === "SameName");
    expect(sameName.map((issue) => `${issue.kept}:${issue.named}`)).toEqual(["a property:id"]);
  });
});
