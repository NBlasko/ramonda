import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "contradicting-aria", "tsconfig.json")).findings[
    "aria-that-contradicts-the-tag"
  ] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.html}`);

/**
 * An `aria-*` written `"false"` beside the HTML attribute that says the opposite.
 *
 * The HTML attribute is doing its job — the form refuses to submit, the button will not take a
 * click — and the ARIA one overrides what a screen reader is TOLD about it. The reader hears that
 * the field is optional and then cannot submit, or that the button is available and then nothing
 * happens when they press it.
 *
 * That is worse than either half missing. A control with nothing said about it leaves a reader to
 * find out by trying; one that says the opposite of what it does sends them looking for a fault
 * somewhere else on the page — somebody told a required field is optional does not go back to it.
 */
describe("an accessibility attribute that contradicts the tag", () => {
  test("the two that cost a reader the most", () => {
    expect(said()).toContain("12:required");
    expect(said()).toContain("15:disabled");
  });

  test("and every other pair where HTML sets its ARIA counterpart implicitly", () => {
    expect(said()).toContain("20:checked");
    expect(said()).toContain("21:readonly");
    expect(said()).toContain("22:open");
    // `hidden` with `aria-hidden="false"` is the sharpest of them: gone from the page, announced
    // as present.
    expect(said()).toContain("27:hidden");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    // 58 has the spread BEFORE both attributes, so nothing can reach over either. 65 is the pair
    // written in a `@Host` props bag, which configures a real element.
    expect(said()).toEqual([
      "12:required",
      "15:disabled",
      "20:checked",
      "21:readonly",
      "22:open",
      "27:hidden",
      "58:required",
      "65:required",
    ]);
  });

  /**
   * Saying it TWICE is untidy and is not reported, which is the line this rule draws.
   *
   * `aria-required="true"` beside `required` says one thing twice. This package reports faults
   * rather than untidiness, and a rule that reported agreement would be reporting a habit.
   */
  test("agreeing with the tag is untidy, not a fault", () => {
    expect(found().map((issue) => issue.line)).not.toContain(32);
  });

  test("everything the source does not settle on both halves stays silent", () => {
    /**
     * 35 writes the HTML attribute alone, which is the advice. 40 writes `disabled={false}`, so
     * there is nothing to contradict. 45 binds BOTH to one expression, which is the correct way to
     * write a pair that moves and exactly what a rule that guessed would report. 50 has the ARIA
     * half on something with no HTML attribute to disagree with. 55 spreads after both.
     */
    const lines = found().map((issue) => issue.line);
    for (const quiet of [35, 40, 45, 50, 55]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
