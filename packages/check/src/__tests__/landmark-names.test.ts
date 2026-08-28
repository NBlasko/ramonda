import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "landmark-names", "tsconfig.json")).findings;
const said = () =>
  (run()["landmarks-that-cannot-be-told-apart"] ?? []).map((issue) => `${issue.line}:${issue.kind}/${issue.count}`);

/**
 * Two landmarks of the same kind, neither of them named.
 *
 * A screen reader offers landmarks as a LIST — it is how somebody moves around a page without
 * scrolling through it, and for a reader who cannot see the layout it is the closest thing to
 * glancing at a page. An unnamed landmark is announced by its kind alone, so a primary navigation
 * and a footer navigation read as "navigation, navigation": the reader has to enter one to find out
 * which it is, come back out, and try the other.
 *
 * The fix is one attribute and the page looks identical afterwards, which is why nothing about the
 * rendered page will ever remind anybody.
 */
describe("landmarks a screen reader announces identically", () => {
  test("two unnamed of one kind, and both are reported", () => {
    // Both, not one: each needs a name before the list can be read. That is the opposite of
    // `more-than-one-main`, where one is allowed and only the extras are wrong.
    expect(said()).toContain("12:navigation/2");
    expect(said()).toContain("15:navigation/2");
  });

  test("three are three reports, and the count says how many", () => {
    expect(said()).toContain("28:navigation/3");
    expect(said()).toContain("29:navigation/3");
    expect(said()).toContain("30:navigation/3");
  });

  test("a written `role` is the same landmark as the tag", () => {
    // `<nav>` and `role="navigation"` are one entry in the list twice over.
    expect(said()).toContain("41:navigation/2");
    expect(said()).toContain("42:navigation/2");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(said()).toEqual([
      "12:navigation/2",
      "15:navigation/2",
      "28:navigation/3",
      "29:navigation/3",
      "30:navigation/3",
      "41:navigation/2",
      "42:navigation/2",
    ]);
  });

  /**
   * ONE named and one not is silent, and that is the sharp line this rule draws.
   *
   * Two unnamed landmarks of one kind cannot be told apart — a fact about the list, not a
   * preference. "navigation" and "Footer navigation" are two different entries and CAN be. The
   * convention is to name both; this rule enforces the ambiguity and deliberately not the
   * convention.
   */
  test("one named and one not can be told apart, so neither is reported", () => {
    const lines = (run()["landmarks-that-cannot-be-told-apart"] ?? []).map((issue) => issue.line);
    expect(lines).not.toContain(65);
    expect(lines).not.toContain(66);
  });

  test("every other shape that is unambiguous, or unprovable, stays silent", () => {
    /**
     * 53/54 name both. 77/78 point at headings, which cannot drift apart from them. 89/90 and
     * 101/102 are one landmark of each kind — there is nothing to be told apart FROM. 111 puts one
     * in each arm of a ternary, which is one on the page. 120 has a role this cannot READ, and 132
     * spreads, which may carry the name or a role that changes what it is.
     */
    const lines = (run()["landmarks-that-cannot-be-told-apart"] ?? []).map((issue) => issue.line);
    for (const quiet of [53, 54, 77, 78, 89, 90, 101, 102, 111, 120, 132]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * `main` is absent from the landmark set on purpose.
   *
   * A page may have one, and two is `more-than-one-main`'s report rather than a naming problem —
   * naming them would not make two mains correct. The two rules divide the subject and never report
   * the same line.
   */
  test("two mains are the neighbouring rule's, and only its", () => {
    const mine = (run()["landmarks-that-cannot-be-told-apart"] ?? []).map((issue) => issue.line);
    const mains = (run()["more-than-one-main"] ?? []).map((issue) => issue.line);
    expect(mains).toHaveLength(1);
    for (const line of mains) expect(mine).not.toContain(line);
  });
});
