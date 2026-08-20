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
 * boundary. This fixture asked the obvious next question of the other rules, and five of them
 * reported the literal and went silent one hop away.
 *
 * Four are now closed. `element.ts`'s `attr` and `numberAttr` follow a name to its declaration, and
 * that was one change for the whole accessibility family rather than three rules; `lossyIn` follows
 * one too. The fifth is not a gap at all — see below.
 */
describe("a value written one hop from where the rule looks", () => {
  test("the direct shape is reported by every one of them", () => {
    const findings = run().findings;

    expect(findings["arrow-fields"].map((issue) => issue.field)).toEqual(["directArrow"]);
    expect(findings["persist-of-a-lossy-value"].map((issue) => issue.field)).toContain("directPersist");
    expect(findings["unknown-role"].map((issue) => issue.role)).toContain("buton");
    expect(findings["positive-tabindex"].map((issue) => issue.value)).toContain(5);
    expect(findings["link-without-a-destination"].length).toBeGreaterThan(0);
  });

  test("and so is the same value a `const` or a helper away", () => {
    const findings = run().findings;

    // `role={ROLE}`, `tabIndex={PRIORITY}`, `href={EMPTY}` — one change in `element.ts`, and every
    // element rule reads through it.
    expect(findings["unknown-role"]).toHaveLength(2);
    expect(findings["positive-tabindex"]).toHaveLength(2);
    expect(findings["link-without-a-destination"]).toHaveLength(2);
    // `hopPersist = makeCache()` — a helper returning a `Map` is the same `Map` in the blob.
    expect(findings["persist-of-a-lossy-value"].map((issue) => issue.field)).toContain("hopPersist");
  });

  /**
   * The boundary an attribute reader may not cross, and it is the opposite of the one a
   * fault-finder wants.
   *
   * `role={flag ? "buton" : GOOD}` has no single answer, and taking the first arm would report an
   * element that is right half the time — a rule reporting correct markup is how a rule earns being
   * switched off. A call is the same problem behind a function: more than one `return` and there is
   * no one answer to read. Both are followed by `fresh-object-in-props`, where ANY path that builds
   * is the whole fault, and neither is followed here.
   */
  test("a branch and a call are not followed to an attribute's value", () => {
    const roles = run().findings["unknown-role"];
    expect(roles).toHaveLength(2);
  });

  /**
   * A `let` is not an answer either, and this one was a FALSE REPORT before it was planted.
   *
   * `let role = "buton"; role = "button";` was read off the initializer and reported as
   * `role="buton"` — on an element that says `"button"`. A rule reporting correct markup is the one
   * thing this package may never do, so an attribute reader follows only a binding that cannot be
   * written again. The walks that look for a FAULT still follow a `let`: an object in one is a
   * fresh object however it was declared.
   */
  test("a reassignable binding is not followed to an attribute's value", () => {
    expect(run().findings["unknown-role"]).toHaveLength(2);
  });

  /**
   * `arrow-fields` is the one that stays, and it is not a gap — reading the rule's own claim says
   * so. It reports a function LITERAL in a field, and it leaves a field initialised from a call
   * alone on purpose: `debounce(this.save, 200)` is legitimate, has nowhere else to live, and a
   * walk that followed the call would find the arrow INSIDE `debounce` and report the wrapper.
   *
   * Kept as a test rather than deleted, because "this rule does not follow" is a decision, and a
   * decision with no test is a decision somebody undoes.
   */
  test("arrow-fields does not follow a call, and should not", () => {
    const fields = run().findings["arrow-fields"].map((issue) => issue.field);

    expect(fields).toEqual(["directArrow"]);
    expect(fields).not.toContain("hopArrow");
  });
});
