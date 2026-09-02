import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "aliased-more", "tsconfig.json"));

/**
 * `@StableProps` and `@watchProp` under another name.
 *
 * `hasDecorator` was taught to resolve, and seven other places still compared the name written on
 * the class — the standing lesson here being that a fix for one spelling is not a fix for the
 * others. Planted, and it failed both ways at once:
 *
 * - **A false report.** A child declaring `conf` through an aliased `@StableProps` had that
 *   declaration hidden, so `fresh-object-in-props` reported the literal handed to it — which is
 *   reporting the fix.
 * - **A silence.** An aliased `@watchProp` was seen by nothing.
 *
 * Every decorator read goes through `coreDecoratorName` now, so an app's own decorator of any of
 * these names is still the app's business.
 */
describe("a decorator core exports, written under another name", () => {
  test("an aliased `@watchProp` is watched exactly as the plain one is", () => {
    const found = run().findings["watch-of-a-prop-that-is-not-there"];

    expect(found.map((issue) => `${issue.component}.${issue.member}`).sort()).toEqual([
      "Aliased.onNope",
      "Plain.onNope",
    ]);
  });

  /**
   * The same lesson one step further out: the declaration a context Provider carries is not on a
   * class at all, it is an argument to `createContext` — so the CALL has to be identified as core's,
   * and matching the letters would report the very key that was declared.
   */
  test("an aliased `createContext` still declares its stableProps", () => {
    expect(run().findings["fresh-object-in-hook-props"]).toEqual([]);
  });

  /** The declaration is what makes the literal safe, whatever the decorator is called here. */
  test("an aliased `@StableProps` still declares the prop, so the literal is not reported", () => {
    const found = run().findings["fresh-object-in-props"];

    expect(found.map((issue) => issue.component)).not.toContain("AliasedStableChild");
    expect(found).toEqual([]);
  });
});
