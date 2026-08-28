import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { RULES } from "../rules/index";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "false-on-a-boolean", "tsconfig.json")).findings[
    "false-on-a-boolean-attribute"
  ] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.attribute}`);

/**
 * A boolean attribute written `"false"`, which turns it ON.
 *
 * The parser never reads the value of a boolean attribute — it reads only whether the name is
 * there. So `disabled="false"` puts `disabled` in the document and the control cannot be used,
 * which is the opposite of what the line says and of what whoever wrote it meant.
 *
 * The static twin of core's RMD029: the framework reports it while it runs, and only for markup
 * that renders. This is the same fault found in a branch nobody has opened.
 */
describe("a boolean attribute turned on by the word false", () => {
  test("the three spellings that reach the element the same way", () => {
    // 12 and 16 are written out; 18 holds the string one NAME away, which the DOM cannot tell apart
    // from the literal because `attr` follows it to the same value.
    expect(said()).toEqual(["12:disabled", "16:required", "18:checked"]);
  });

  /**
   * Six silences, and the first two are the FIX rather than the fault.
   *
   * 21 passes the boolean itself and 25 a condition — both remove the attribute, which is the only
   * way HTML has of turning one off, so reporting either would be reporting the correct code.
   * 27 says `"true"`, which is present and on and is what it says.
   *
   * 30 and 32 are the other half of the line this rule draws: an `aria-*` is an enumerated STRING
   * where `"false"` is a real value meaning "not hidden", and a `data-*` is data something reads
   * back. Neither is in `BOOLEAN_ATTRIBUTES`, which is why this asks the table rather than the
   * shape of the value.
   *
   * 35 spreads AFTER the attribute, and the spread may replace it or take it away — and this report
   * names an OUTCOME, so it is only made where the outcome is provable.
   */
  test("the fix, the true form, the other kinds of attribute, and a spread all stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [21, 25, 27, 30, 32, 35]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * The report says what the ELEMENT will do, in the same words core uses at runtime.
   *
   * Two packages describing one fault should not describe it two ways: a reader who has seen
   * RMD029 in the console and then meets this in CI is looking at the same sentence.
   */
  test("and it names the outcome, not the rule", () => {
    const rule = RULES.find((r) => r.id === "false-on-a-boolean-attribute");
    const printed = found().map((issue) => (rule?.report.lines(issue as never) ?? []).join(" "));

    expect(printed.some((line) => line.includes("the control is disabled and cannot be used"))).toBe(true);
    expect(printed.some((line) => line.includes("the form will not submit without it"))).toBe(true);
    expect(printed.some((line) => line.includes("the box is checked"))).toBe(true);
  });
});
