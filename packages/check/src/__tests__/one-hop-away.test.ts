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
 *
 * **Closing `attr` did not close the question**, which is the part worth carrying. Four more rules
 * read an element through a DIFFERENT helper — `stringAttr`, `trueAttr`, the id table's own reader
 * — and every one of those was still literal-only afterwards. None of it is visible from a rule's
 * own source: each calls something whose name says it reads the attribute. `element-family` and
 * `id-table-hop` are that measurement, and two of the four were reporting correct markup.
 *
 * **Six rules arrived after the ladder and none was in here.** Three read a value and are asked the
 * same question below; three cannot be walked around at all and say so rather than staying silent.
 * A rule missing from this file is a rule nobody re-asks the question of, which is how the four
 * readers above went unnoticed for as long as they did.
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

  /**
   * The rules added since this fixture was written, asked the same question.
   *
   * Six arrived after the ladder and none was in here. Three of them read a VALUE, which is the
   * kind an author walks around by moving it one `const` away — so each is planted twice, written
   * where the rule looks and then one hop from it, and the two must land on DIFFERENT lines. A
   * count of two proves nothing on its own: a rule reporting the direct site twice would say the
   * same number.
   *
   * All three go through `attr`, so they inherited the walk rather than needing one. Measured
   * rather than assumed — that is the whole point of the fixture, and this makes it a standing
   * claim instead of a check somebody did once before a PR.
   */
  test("the rules added since read a value through the same walk", () => {
    const findings = run().findings;

    for (const rule of ["region-with-no-name", "false-on-a-boolean-attribute", "half-built-keyboard-path"]) {
      const lines = findings[rule].map((issue) => issue.line);
      expect(lines, rule).toHaveLength(2);
      expect(new Set(lines).size, `${rule}: the direct site and the hop are different lines`).toBe(2);
    }
  });

  /**
   * And the three that CANNOT be walked around, said out loud rather than left silent.
   *
   * `misspelled-element-property` reads a property NAME, `element-html-removed` reads a TAG, and
   * `option-that-cannot-choose` asks whether an attribute is there and reads no value at all. None
   * of those can be moved behind a `const`: a name is not an expression. So there is no one-hop
   * form to plant, and their absence from the list above is a fact about them rather than a gap.
   *
   * Written as a test because "this rule needs no walk" is a decision, and a decision with no test
   * is one somebody undoes — here by adding a walk nothing asked for.
   */
  test("and the three with no value to move report from the source itself", () => {
    const findings = run().findings;

    expect(findings["misspelled-element-property"].map((issue) => issue.written)).toEqual(["playbackrate"]);
    expect(findings["element-html-removed"]).toHaveLength(1);
    expect(findings["option-that-cannot-choose"]).toHaveLength(1);
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

  /**
   * `function-built-in-the-markup` is the props side of `arrow-fields`, and it makes the same two
   * decisions for the same two reasons: it follows a NAME to the local one line up, because that is
   * the same function built at the same moment, and it does NOT follow a CALL, because a call is
   * the recommended answer rather than the fault — `@memoized pickRow(row)` hands back a cached
   * handler and `debounce(this.save, 200)` has nowhere else to live.
   *
   * Recorded here as well as in the rule's own fixture, because this file is the live record of
   * which rules follow a value and which match a shape, and a rule missing from it is a rule
   * nobody re-asks the question of.
   */
  test("function-built-in-the-markup follows a local and not a call", () => {
    const written = run().findings["function-built-in-the-markup"].map((issue) => issue.written);

    expect(written).toEqual(["() => this.save()", "hopHandler"]);
    expect(written).not.toContain("makeHandler()");
  });
});
