import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "presentational-role", "tsconfig.json")).findings[
    "presentation-role-on-focusable"
  ] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.tag}/${issue.because}`);

/**
 * `role="presentation"` where the spec IGNORES it.
 *
 * `presentation` and its synonym `none` say the element is scaffolding. ARIA drops that role when
 * it cannot hold, and a FOCUSABLE element is the case — it keeps its implicit role. So the author
 * asked for the element to leave the accessibility tree and it did not, with nothing at build time
 * and nothing at runtime to say so.
 *
 * Written from the spec's presentational role conflict resolution, and the boundary is drawn where
 * the spec stops being uncontested: the OTHER half of that resolution, a global `aria-*` on the
 * same element, is deliberately not reported — see the rule.
 */
describe("a presentational role on something focusable", () => {
  test("a tag that is focusable on its own, and both spellings of the role", () => {
    // 11 `<button role="presentation">`, 16 `<input role="none">`. `none` is the synonym ARIA added
    // because `presentation` reads like a visual instruction, and it is the same claim.
    expect(said()).toContain("11:button/the tag");
    expect(said()).toContain("16:input/the tag");
  });

  test("and a `tabIndex` that put a plain element into the tab order", () => {
    // 19 written out, 24 with the role a `const` away — the reader follows a name, as the family does.
    expect(said()).toContain("19:div/tabIndex");
    expect(said()).toContain("24:div/tabIndex");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    /**
     * 40 is `<a href>` — an anchor is focusable only WITH one, which is why 37 is not here. 63 has
     * the spread first and its `tabIndex` written after it, so the spread cannot reach over either.
     */
    expect(said()).toEqual([
      "11:button/the tag",
      "16:input/the tag",
      "19:div/tabIndex",
      "24:div/tabIndex",
      "40:a/the tag",
      "63:div/tabIndex",
    ]);
  });

  /**
   * The seven silences, each of which a worse rule would have reported.
   *
   * `tabIndex={-1}` is one of the two fixes this rule advises, so reporting it would be reporting
   * the fix. A `<div>` with no tab order is scaffolding a keyboard cannot reach, which is exactly
   * what the role is for. An `<a>` with no `href` and an `<input type="hidden">` are not focusable.
   * An unreadable `tabIndex` says nothing either way. And the two spread cases are the family's own
   * asymmetry: a spread AFTER the role may replace it, and a spread anywhere on a tag-focusable
   * element may be carrying the `tabIndex={-1}` that settles it.
   */
  test("every shape that is correct, or unprovable, stays silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [29, 34, 37, 45, 48, 53, 58, 68]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  test("and a role that is not presentational is nobody's business here", () => {
    // 68 is `<button role="switch" aria-checked="false">` — a real role on a real control.
    expect(found().map((issue) => issue.tag)).not.toContain("switch");
  });
});
