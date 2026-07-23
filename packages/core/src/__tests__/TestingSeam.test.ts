import { describe, test, expect } from "vitest";
import * as seam from "../testing";
import * as api from "../index";

/**
 * `@ramonda/core/testing` is the second door — the one a test harness reaches
 * the internals through, so that `index.ts` does not have to be widened for it.
 *
 * A second door is only safe while it stays narrow, and nothing about a
 * `export { … }` line makes it stay narrow. This is the tripwire: adding to the
 * seam means updating this list on purpose.
 *
 * `PublicSurface.test.ts` and `InternalFolders.test.ts` do the same job for the
 * app-facing entry. All three exist because the mistake they catch — an internal
 * becoming API by accident — is invisible in a diff and permanent once shipped.
 */

const EXPECTED = ["flushSync", "rerenderRoot", "getComponentInstance"];

describe("the testing seam", () => {
  test("exports exactly the three things a harness needs", () => {
    expect(Object.keys(seam).sort()).toEqual([...EXPECTED].sort());
  });

  test("does not duplicate anything the public entry already offers", () => {
    // A harness should reach `bootstrap` / `unmount` / `h` the same way an app
    // does. Re-exporting them here would give the same name two import paths
    // and two chances to drift.
    const overlap = Object.keys(seam).filter((name) => name in api);
    expect(overlap).toEqual([]);
  });

  test("the public entry still does not leak the internals the seam covers", () => {
    // The seam exists so this stays true. If `flushSync` ever turns up on the
    // main entry, the seam has stopped being a seam.
    for (const name of EXPECTED) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
