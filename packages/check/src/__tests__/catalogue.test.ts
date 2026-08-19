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
      // A LIST now: one rule can answer several codes — `duplicate-decorators` answers four, one
      // per single-use decorator, because what the framework does about each differs.
      for (const code of rule.alsoReportedAs ?? []) {
        expect(code, rule.id).toMatch(/^RMD\d{3}$/);
      }
    }
  });

  /**
   * No code is claimed by two rules.
   *
   * Not a style point: a reader who sees `RMD005` and looks it up must find ONE static check to
   * read, and two rules answering the same code means the reference sends them to a fork in the
   * road with no way of knowing which half is theirs.
   */
  test("no diagnostic is claimed twice", () => {
    const claimed = new Map<string, string>();
    for (const rule of ruleCatalogue()) {
      for (const code of rule.alsoReportedAs ?? []) {
        // `RMD023` is the one exception, and it is a real pair: `row-without-a-key` reports a row
        // with no key at all, `index-as-key` reports one whose key says only where the row was.
        if (code === "RMD023") continue;
        expect(claimed.has(code), `${code} is claimed by ${claimed.get(code)} and ${rule.id}`).toBe(false);
        claimed.set(code, rule.id);
      }
    }
  });
});
