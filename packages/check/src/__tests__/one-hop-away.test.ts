import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "one-hop", "tsconfig.json"));

/**
 * The same value, written where the rule looks and then ONE HOP away.
 *
 * `fresh-object-in-props` was taken through every shape in `.claude/skills/writing-a-static-rule`
 * and the ladder found nine gaps in a rule that already had tests, a fixture and a documented
 * boundary. This asks the obvious next question: how many OTHER rules match a shape where they
 * should follow a value?
 *
 * The answer is an inventory rather than a fix. Each silence below is a real gap — the value is
 * provably the thing the rule is about, and `follow-value.ts` can prove it — and each is left
 * standing on purpose, because changing five rules at once is not something to do in passing.
 *
 * **When one of these is fixed, this test fails, and that failure is the point.** Move the row from
 * one expectation to the other and take the rule through the rest of the ladder while you are there.
 */
describe("a rule that matches a shape instead of following a value", () => {
  test("the direct shape is reported by every one of them", () => {
    const findings = run().findings;

    expect(findings["arrow-fields"].map((issue) => issue.field)).toEqual(["directArrow"]);
    expect(findings["persist-of-a-lossy-value"].map((issue) => issue.field)).toEqual(["directPersist"]);
    expect(findings["unknown-role"].map((issue) => issue.role)).toEqual(["buton"]);
    expect(findings["positive-tabindex"].map((issue) => issue.value)).toEqual([5]);
    expect(findings["link-without-a-destination"]).toHaveLength(1);
  });

  /**
   * The gap, as it stands today.
   *
   * The three element rules are not three rules: `element.ts`'s `attr()` reads a string literal and
   * nothing else, and every element rule reads through it — so one change there moves the whole
   * accessibility family at once.
   */
  test("the same value one hop away is silent in all five", () => {
    const findings = run().findings;

    // `hopArrow = makeHandler()` — a helper returning an arrow.
    expect(findings["arrow-fields"].map((issue) => issue.field)).not.toContain("hopArrow");
    // `hopPersist = makeCache()` — a helper returning a `Map`.
    expect(findings["persist-of-a-lossy-value"].map((issue) => issue.field)).not.toContain("hopPersist");
    // `role={ROLE}`, `tabIndex={PRIORITY}`, `href={EMPTY}` — a `const` holding the literal.
    expect(findings["unknown-role"]).toHaveLength(1);
    expect(findings["positive-tabindex"]).toHaveLength(1);
    expect(findings["link-without-a-destination"]).toHaveLength(1);
  });
});
