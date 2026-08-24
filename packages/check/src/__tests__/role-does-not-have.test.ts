import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "role-does-not-have", "tsconfig.json")).findings;
const said = () =>
  (run()["aria-state-the-role-does-not-have"] ?? []).map((issue) => `${issue.line}:${issue.role}/${issue.attribute}`);

/**
 * An `aria-*` written beside a `role` that does not have it.
 *
 * ARIA defines every non-global state as belonging to particular roles and exposes it only there.
 * `<div role="button" aria-checked={on}>` is the shape: somebody built a toggle, reached for
 * `button` because that is what it looks like, and wired up the state that works on `switch`. The
 * attribute lands in the DOM, updates with the state, and is announced by nobody.
 *
 * This is the other half of `aria-state-with-no-role`. That one is certain because a `<div>` has no
 * role; this one is certain because the role is written in the source. Between them they need no
 * table of implicit roles for HTML at all, which is the reason both can ship.
 */
describe("an accessibility state the element's role does not have", () => {
  test("the shape it is usually written in", () => {
    expect(said()).toContain("13:button/aria-checked");
    expect(said()).toContain("18:menuitem/aria-selected");
    expect(said()).toContain("23:button/aria-valuenow");
  });

  test("two on one element are two reports, because each is its own line to delete", () => {
    expect(said()).toContain("28:tab/aria-checked");
    expect(said()).toContain("28:tab/aria-level");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    // 85 has the spread BEFORE both attributes, so nothing can reach over either. 94 is the pair
    // written in a `@Host` props bag, which configures a real element.
    expect(said()).toEqual([
      "13:button/aria-checked",
      "18:menuitem/aria-selected",
      "23:button/aria-valuenow",
      "28:tab/aria-checked",
      "28:tab/aria-level",
      "85:button/aria-checked",
      "94:button/aria-checked",
    ]);
  });

  /**
   * A role that INHERITS the state, which is what the flattened table is for.
   *
   * `treeitem` takes `aria-checked`, `aria-level` and `aria-selected` from three different places in
   * the specification's role hierarchy, and `columnheader` takes `aria-sort` and `aria-colindex`
   * from two. Read role-first, every one of those is a superclass lookup that can be missed — and a
   * missed one is a report against markup that works. Read attribute-first, the inheritance is
   * already flattened into the list, and these two lines are what proves it.
   */
  test("a role that inherits the state is silent, which is the whole reason the table is attribute-first", () => {
    const lines = (run()["aria-state-the-role-does-not-have"] ?? []).map((issue) => issue.line);
    expect(lines).not.toContain(44);
    expect(lines).not.toContain(47);
  });

  test("every other shape that says something, or might, stays silent", () => {
    /**
     * 33/36/39 use the role the state belongs to. 52 is three GLOBAL attributes, which belong to
     * everything. 57 is `aria-required`, which the table deliberately does not carry — its role set
     * is long and its inheritance fiddly, and being wrong there means reporting markup that works.
     * 67 has a role this cannot READ and 72 a fallback CHAIN, where which role wins is not a
     * question about the element. 80 spreads after the role, which may replace it.
     */
    const lines = (run()["aria-state-the-role-does-not-have"] ?? []).map((issue) => issue.line);
    for (const quiet of [33, 36, 39, 52, 57, 67, 72, 80]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * The three neighbouring rules divide one subject and never report the same line.
   *
   * 62 has an unknown role, which is `unknown-role`'s. 77 has NO role, which is
   * `aria-state-with-no-role`'s. Two reports on one line is how a reader learns to skim past both,
   * so each of the three answers exactly the part that is its own.
   */
  test("an unknown role and a missing one each belong to the neighbour whose sentence they are", () => {
    const lines = (run()["aria-state-the-role-does-not-have"] ?? []).map((issue) => issue.line);
    expect(lines).not.toContain(62);
    expect(lines).not.toContain(77);
    expect((run()["unknown-role"] ?? []).map((issue) => issue.line)).toEqual([62]);
    expect((run()["aria-state-with-no-role"] ?? []).map((issue) => issue.line)).toEqual([77]);
  });
});
