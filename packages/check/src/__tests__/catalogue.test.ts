import { describe, expect, test } from "vitest";
import { RULES, ruleCatalogue } from "../rules";

/**
 * The rule tables on the documentation site are generated from this, so what it answers is what a
 * reader is told the checker does. These are the properties the generator assumes and cannot check
 * for itself: it would happily print an empty cell, or two rows with the same name.
 */
describe("the rule catalogue", () => {
  test("describes every rule, and nothing else", () => {
    expect(ruleCatalogue().map((rule) => rule.id)).toEqual(RULES.map((rule) => rule.id));
  });

  test("no two rules share an id", () => {
    const ids = ruleCatalogue().map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The type demands the field; it cannot demand that anybody filled it in. An empty string is what
   * a rule added in a hurry would carry, and it renders as a blank cell in a table whose whole point
   * is that a reader can see what every rule reports.
   */
  test("every rule says when it reports", () => {
    for (const rule of ruleCatalogue()) {
      expect(rule.reportedWhen.trim().length, rule.id).toBeGreaterThan(20);
    }
  });

  /**
   * It is printed after the rule's id, completing "reported when" — so a capital or a full stop
   * would read as a sentence dropped into the middle of one.
   */
  test("it is a clause, not a sentence", () => {
    for (const rule of ruleCatalogue()) {
      expect(rule.reportedWhen.endsWith("."), rule.id).toBe(false);
    }
  });

  /**
   * The generator turns this into a link, and the docs build refuses a code the diagnostics page
   * does not document. This catches the other half — a code that is not a code at all.
   */
  test("a named diagnostic is spelled like one", () => {
    for (const rule of ruleCatalogue()) {
      if (rule.alsoReportedAs === undefined) continue;
      expect(rule.alsoReportedAs, rule.id).toMatch(/^RMD\d{3}$/);
    }
  });
});
