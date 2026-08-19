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
   * Which rules answer each runtime code, written down rather than left to chance.
   *
   * A reader who sees `RMD005` and looks it up has to find the static check that explains it. Most
   * codes have exactly one, and a SECOND appearing by accident would send that reader to a fork in
   * the road with no way of knowing which half is theirs.
   *
   * Some genuinely have two, though, and each pair is two halves of one code rather than two rules
   * saying the same thing — so the pairs are declared here with the reason. The test is not "never
   * two"; it is "exactly the ones written down", which makes adding a second claimant a deliberate
   * act instead of something nobody notices.
   */
  const PAIRS: Record<string, { rules: string[]; because: string }> = {
    RMD023: {
      rules: ["row-without-a-key", "index-as-key"],
      because: "a row with no key at all, and a row whose key says only where it was",
    },
    RMD050: {
      rules: ["duplicate-decorators", "decorator-that-adds-nothing"],
      because: "the same decorator written twice, and two different ones giving a member the same thing",
    },
    RMD033: {
      rules: ["persist-of-a-lossy-value", "unserializable-state"],
      because:
        "`@persist`, which claims the blob whatever the project does, and `@state`, which only crosses under SSR",
    },
  };

  test("each runtime code is answered by exactly the rules written down here", () => {
    const claimants = new Map<string, string[]>();
    for (const rule of ruleCatalogue()) {
      for (const code of rule.alsoReportedAs ?? []) {
        claimants.set(code, [...(claimants.get(code) ?? []), rule.id]);
      }
    }

    for (const [code, rules] of claimants) {
      const pair = PAIRS[code];
      if (pair === undefined) {
        expect(rules, `${code} is answered by ${rules.join(" and ")} — declare the pair or fix it`).toHaveLength(1);
        continue;
      }
      expect([...rules].sort(), `${code}: ${pair.because}`).toEqual([...pair.rules].sort());
    }

    // A pair that stops being one is as much a drift as a pair nobody declared.
    for (const code of Object.keys(PAIRS)) {
      expect(claimants.has(code), `${code} is declared as a pair and nothing answers it`).toBe(true);
    }
  });
});
