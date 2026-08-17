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
   * Every rule is accounted for, so a new one cannot be neither.
   *
   * The list this replaced could be short by one and still compile. This cannot: a rule is in
   * `RULES` or it does not run at all, and its severity decides which half it lands in.
   */
  test("every rule is either a warning or a failure", () => {
    const warns = RULES.filter((rule) => rule.report.severity === "warn");
    const errors = RULES.filter((rule) => rule.report.severity === "error");
    expect(warns.length + errors.length).toBe(RULES.length);
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

  test("a warning-only finding does not fail the run", () => {
    const result = run("dynamic-import");
    expect(result.findings["unsplittable-import"].length).toBeGreaterThan(0);
    expect(failingRules(result.findings)).toEqual([]);
  });
});
