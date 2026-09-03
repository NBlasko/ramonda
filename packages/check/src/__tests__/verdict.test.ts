import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { RULES, emptyFindings, failingRules } from "../rules";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * What decides whether a run fails, and why it is derived rather than listed.
 *
 * `ramonda-check` prints "everything is fine" and exits 0 when nothing is wrong, and the condition
 * used to carry a clause per rule — `arrowFields.length === 0 && duplicateDecorators.length === 0
 * && …`. A rule added without its clause makes that line print DIRECTLY ABOVE its own report, and
 * the command exits 0 with a real fault in the project. It is the worst shape a bug in a checker
 * can take: it does not miss the fault, it finds it and then says there is none.
 */
describe("what fails a run", () => {
  test("a rule that found nothing fails nothing", () => {
    expect(failingRules(emptyFindings())).toEqual([]);
  });

  /**
   * Every rule is an error, and adding one that is not has to be a decision.
   *
   * There were seventy-seven warnings and nine errors, and seventy-two of the warnings said in
   * their own advice that they would become errors "in a later version". Nothing was tracking
   * that, and a warning that never fails anything is worse than an error with an escape hatch: the
   * warning is ignored in silence, while `// ramonda-check-ignore <reason>` is a decision somebody
   * wrote down and every run prints back.
   *
   * So this is a tripwire rather than an invariant. A warning may be the right answer for some
   * future rule — the CLI still honours one, and `failingRules` still reads severity — but it may
   * not happen by accident, because nothing else would notice.
   */
  test("no rule is a warning", () => {
    // Widened on purpose. `RULES` is `as const`, so every severity is the literal `"error"` and
    // `=== "warn"` is a comparison `tsc` refuses as provably false — which is the compiler making
    // this test's own point and then preventing it from being written. Reading through the
    // declared union asks the question at runtime, where it belongs.
    const severities: readonly ("warn" | "error")[] = RULES.map((rule) => rule.report.severity);

    expect(severities.filter((severity) => severity === "warn")).toEqual([]);
    expect(RULES.length).toBeGreaterThan(0);
  });

  /**
   * The fixture that exists for exactly this question.
   *
   * Every other fixture also reports something from the graph — an unreachable declaration, a
   * consumer with no provider, a name that could not be followed — so on none of them can the
   * rule half of the verdict be told apart from the graph half.
   */
  test("a project whose only fault is a rule's finding still fails", () => {
    const result = run("only-a-rule");

    // Precisely one rule speaks, and the graph says nothing at all.
    expect(failingRules(result.findings).map((rule) => rule.id)).toEqual(["duplicate-decorators"]);
    expect(result.issues).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.unreachable).toEqual([]);
    expect(result.unreachableRoutes).toEqual([]);
    expect(result.secondProviders).toEqual([]);
    expect(result.renderCycles).toEqual([]);
    expect(result.classesAsChildren).toEqual([]);
  });

  /**
   * The fixture that used to prove the opposite.
   *
   * `unsplittable-import` was a warning, and this asserted that finding it left the run passing.
   * It is an error now, so the same fixture proves the other half of the same mechanism: a
   * severity is what puts a rule in the verdict, and this one is in it.
   */
  test("a finding from a rule that was once a warning fails the run now", () => {
    const result = run("dynamic-import");

    expect(result.findings["unsplittable-import"].length).toBeGreaterThan(0);
    expect(failingRules(result.findings).map((rule) => rule.id)).toContain("unsplittable-import");
  });
});
