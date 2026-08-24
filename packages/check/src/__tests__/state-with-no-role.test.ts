import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "state-with-no-role", "tsconfig.json")).findings;
const said = () =>
  (run()["aria-state-with-no-role"] ?? []).map((issue) => `${issue.line}:${issue.tag}/${issue.attribute}`);

/**
 * An `aria-*` that belongs to a ROLE, on an element that has none.
 *
 * ARIA divides its attributes in two: a GLOBAL one is exposed on anything in the accessibility
 * tree, and every other one is defined BY a role and exposed only where that role supports it.
 * `<div aria-expanded={open}>` beside a custom dropdown is the commonest shape of the fault — the
 * value is wired up correctly, lands in the DOM, updates as the state changes, and reaches nobody.
 *
 * Written from the specification's own global list. Narrower than the spec on purpose: see the rule
 * for why the full "does this role support this attribute" question is left to a later one.
 */
describe("an accessibility state with no role to belong to", () => {
  test("a state on a generic element, in both tags that certainly have no role", () => {
    expect(said()).toContain("13:div/aria-expanded");
    expect(said()).toContain("16:span/aria-checked");
  });

  test("two on one element are two reports, because each is its own line to delete", () => {
    expect(said()).toContain("19:div/aria-selected");
    expect(said()).toContain("19:div/aria-level");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    // 59 is the state written in a `@Host` props bag, which configures a real element.
    expect(said()).toEqual([
      "13:div/aria-expanded",
      "16:span/aria-checked",
      "19:div/aria-selected",
      "19:div/aria-level",
      "59:div/aria-expanded",
    ]);
  });

  /**
   * The seven silences, and each is a different reason.
   *
   * 24 is three GLOBAL attributes, which work on anything. 29 is `aria-hidden` — global AND doing
   * something here, since it takes the subtree out of the tree, so it is exactly the attribute a
   * rule about "this says nothing" must not report. 32 has a role written and 37 has one this
   * cannot READ, which is still a role and still not something to claim is absent. 42 is a
   * `<button>`, whose implicit role this rule deliberately does not have a table for. 50 spreads,
   * and the spread may be carrying the role.
   */
  test("every shape that says something, or might, stays silent", () => {
    const lines = (run()["aria-state-with-no-role"] ?? []).map((issue) => issue.line);
    for (const quiet of [24, 29, 32, 37, 42, 50]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * A misspelling belongs to the neighbouring rule and gets ONE report, not two.
   *
   * `aria-expandd` is not an ARIA attribute at all, so there is no question about which role it
   * belongs to — `unknown-aria-attribute` says more about it than this rule could, and two rules on
   * one line is how a reader learns to skim past both.
   */
  test("a misspelling is the neighbouring rule's, and only its", () => {
    expect(said().map((s) => Number(s.split(":")[0]))).not.toContain(47);
    expect((run()["unknown-aria-attribute"] ?? []).map((issue) => issue.line)).toEqual([47]);
  });
});
