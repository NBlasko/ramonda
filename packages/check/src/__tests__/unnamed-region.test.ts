import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "unnamed-region", "tsconfig.json")).findings["region-with-no-name"] ?? [];
const lines = () => found().map((issue) => issue.line);

/**
 * `role="region"` with nothing to name it.
 *
 * `region` is the only landmark role the specification makes conditional on a name: WAI-ARIA says
 * authors MUST label one, and an unnamed one is not exposed as a landmark at all. So the attribute
 * does nothing — the element is a generic box, exactly as it would have been with no `role` typed
 * on it, and nothing on the page looks wrong.
 *
 * That is what makes it worth reporting and what makes it hard to notice: an intention that failed
 * silently, rather than markup that misleads.
 */
describe("a region that never becomes a landmark", () => {
  test("declared and unnamed, including a name written EMPTY", () => {
    // 12 has nothing; 15 has an `aria-label=""`, which is an author who wrote a name and left it
    // blank. The accessibility tree gets no name from either, so neither is in the landmark list.
    expect(lines()).toEqual([12, 15]);
  });

  /**
   * Six silences, and the first is the one that decides whether this rule is usable at all.
   *
   * 34 is a bare `<section>`. It maps to `region` only when it HAS a name and to `generic` when it
   * does not — the mapping working as designed, not a failure. Reporting it would report ordinary
   * correct markup on nearly every page ever written, and bury the real fault under it. The line is
   * the WRITTEN role: typing `role="region"` is asking for a landmark.
   *
   * 20 and 25 are named the two real ways. 29 is a name this cannot READ, which is somebody naming
   * it. 37 spreads, and the spread may be carrying the name. 41 has a role this cannot read, which
   * may not be a region at all, and 43 is a chain whose winner is not a question about this element.
   */
  test("everything that is not a failed landmark stays silent", () => {
    for (const quiet of [20, 25, 29, 34, 37, 41, 43]) {
      expect(lines(), `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * And the sibling rule says nothing here, which is the point of taking `region` out of its list.
   *
   * `landmarks-that-cannot-be-told-apart` fires only when NEITHER of two landmarks of a kind is
   * named — which for `region` is exactly the case where neither IS a landmark. Measured on this
   * fixture before the change: both rules named lines 12 and 15, and only one of them was saying
   * something true.
   */
  test("and the landmark-naming rule leaves it alone, so one fault gets one report", () => {
    const others =
      analyzeProject(join(here, "fixtures", "unnamed-region", "tsconfig.json")).findings[
        "landmarks-that-cannot-be-told-apart"
      ] ?? [];

    expect(others).toEqual([]);
  });
});
