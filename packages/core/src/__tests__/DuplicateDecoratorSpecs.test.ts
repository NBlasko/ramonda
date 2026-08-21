import { describe, expect, test } from "vitest";
import { SPECS } from "../debug/diagnostics";
import * as api from "../index";

/**
 * The `duplicate` field on a diagnostic names decorators that EXIST.
 *
 * `scripts/check-decorator-duplication.mjs` holds core and `@ramonda/check` to the same story about
 * what a second `@StableProps` does. This closes the one hole that check cannot see: a misspelled
 * name. `duplicate: { decorators: ["catchErrors"] }` and an analyzer table saying the same would AGREE
 * perfectly, pass that script, and describe a decorator this framework does not have — so the rule
 * would report nothing and the advice would be about nothing.
 *
 * Read off the real export list rather than a second list of names, which is the mistake this whole
 * chain exists to stop.
 */
describe("a diagnostic's `duplicate` field", () => {
  const named = Object.entries(SPECS).flatMap(([code, spec]) =>
    (spec.duplicate?.decorators ?? []).map((decorator) => ({ code, decorator })),
  );

  test("names a decorator the package actually exports", () => {
    // A floor, so the loop below cannot pass by finding nothing.
    expect(named.length).toBeGreaterThan(5);

    for (const { code, decorator } of named) {
      expect(typeof (api as Record<string, unknown>)[decorator], `${code} names @${decorator}`).toBe("function");
    }
  });

  test("and no decorator is described by two codes, which would be two answers", () => {
    const seen = new Map<string, string>();
    for (const { code, decorator } of named) {
      const first = seen.get(decorator);
      expect(first, `@${decorator} is described by ${first} and ${code}`).toBeUndefined();
      seen.set(decorator, code);
    }
  });
});
