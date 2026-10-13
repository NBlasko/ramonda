import { afterEach, describe, expect, test } from "vitest";
import { configureDev } from "../index";
import { devFlags } from "../config";

/**
 * `configureDev` with a flag it does not mention.
 *
 * The union of both coverage runs named this one branch and nothing else in the file:
 * `if (flags.strictRender !== undefined)` — 405 calls took the true side in the development run, and
 * **neither run ever took the false side**. So nothing had ever called `configureDev` with an object
 * that leaves `strictRender` alone, which is what every caller will do the day a second flag exists.
 *
 * It is a DEV test rather than a production one, and that correction matters: the `if (!__DEV__)`
 * guard above it is already covered from both sides — 405 in development, 11 in production, because
 * `vitest.prod.config.ts` uses the same `src/test/setup.ts`, and that file calls `configureDev`. The
 * production side of this function was never the gap.
 *
 * The flag is saved and put back, because `setup.ts` sets it to `false` for the whole run and other
 * files set it deliberately in a `beforeEach`. A test that left it changed would make its neighbours
 * depend on the order they run in.
 */
describe("configureDev", () => {
  const before = devFlags.strictRender;

  afterEach(() => {
    devFlags.strictRender = before;
  });

  test("leaves a flag it does not mention alone", () => {
    devFlags.strictRender = true;

    configureDev({});

    expect(devFlags.strictRender).toBe(true);
  });

  test("and the same when the current value is the other one", () => {
    // Both starting points, because "unchanged" is only a claim if it can be told from "set to a
    // constant": a body that assigned `true` unconditionally would pass the test above.
    devFlags.strictRender = false;

    configureDev({});

    expect(devFlags.strictRender).toBe(false);
  });

  test("sets the flag it does mention", () => {
    devFlags.strictRender = true;

    configureDev({ strictRender: false });

    expect(devFlags.strictRender).toBe(false);
  });
});
