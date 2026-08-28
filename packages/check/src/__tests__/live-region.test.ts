import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "live-region", "tsconfig.json")).findings[
    "live-region-that-contradicts-its-role"
  ] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.role}->${issue.written}`);

/**
 * An `aria-live` that undoes the urgency the role was chosen for.
 *
 * `role="alert"` is `assertive` and interrupts; `role="status"` is `polite` and waits for a gap. An
 * explicit `aria-live` REPLACES that, and there are only two values it can take — so writing one is
 * always either redundant or a reversal.
 *
 * An alert made polite waits: a validation error or a failed save announced when the reader happens
 * to pause, which on a form being filled in may be minutes later or never. A status made assertive
 * interrupts on every change — a live result count cutting across every keystroke, and the usual
 * outcome is that the reader turns the page's announcements off entirely, which takes the real
 * messages with them.
 */
describe("a live region whose urgency was undone", () => {
  test("both directions, each costing something different", () => {
    expect(said()).toContain("13:alert->polite");
    expect(said()).toContain("18:status->assertive");
  });

  test("and the two rarer live roles behave the same way", () => {
    // `log` and `timer` are live regions and both are `polite`. Far rarer, and here for
    // completeness rather than because anybody has been caught by them.
    expect(said()).toContain("23:log->assertive");
    expect(said()).toContain("26:timer->assertive");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    // 66 has the spread BEFORE both halves, so nothing can reach over either.
    expect(said()).toEqual([
      "13:alert->polite",
      "18:status->assertive",
      "23:log->assertive",
      "26:timer->assertive",
      "66:alert->polite",
    ]);
  });

  /**
   * Agreement is untidy, not a fault — the line this rule draws.
   *
   * `role="alert" aria-live="assertive"` says one thing twice. This package reports faults rather
   * than habits, and a rule that reported agreement would be reporting a style.
   */
  test("agreeing with the role is untidy, not a fault", () => {
    const lines = found().map((issue) => issue.line);
    expect(lines).not.toContain(35);
    expect(lines).not.toContain(38);
  });

  test("everything that is not a reversal stays silent", () => {
    /**
     * 31 and 32 write the role alone, which is the advice. 43 says `off`, which is a stronger claim
     * than a politeness — it says the region is not live at all — and belongs to whoever wrote it.
     * 48 writes `aria-live` with no role, which is one source for the politeness rather than two.
     * 51 has a politeness this cannot READ. 56 is a role that is not a live region. 61 spreads
     * after both.
     */
    const lines = found().map((issue) => issue.line);
    for (const quiet of [31, 32, 43, 48, 51, 56, 61]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
