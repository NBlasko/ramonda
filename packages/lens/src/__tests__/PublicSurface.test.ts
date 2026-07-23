import { describe, test, expect } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * The same tripwire core has, and for the same reason: an export added for an
 * internal convenience silently becomes public API, and a published surface is
 * much harder to take back than to refuse. Adding something on purpose means
 * updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to
 * be acknowledged twice — once as API, once as documentation.
 */
const EXPECTED = ["focusOn"];

/**
 * The internals a consumer must not reach.
 *
 * The walk and the step shapes are the sharp ones: a caller able to build a
 * `Step` by hand could aim a write at a path the type system never checked,
 * which is the one thing the chain exists to prevent.
 */
const FORBIDDEN = [
  "walk",
  "replace",
  "removeAt",
  "collect",
  "shallowClone",
  "isContainer",
  "exoticName",
  "formatPath",
  "warn",
  "Chain",
  "NO_STEPS",
];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("the internals are not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
