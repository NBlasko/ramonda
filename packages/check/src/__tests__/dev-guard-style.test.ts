import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "dev-guard-style", "tsconfig.json"));
const found = () => run().findings["dev-guard-as-an-expression"];

/**
 * A `__DEV__` guard written as an operator rather than as an `if`.
 *
 * **Not a dead-code rule, and the measurement says so.** With esbuild and `__DEV__: false` the `&&`
 * form is DROPPED where an unminified `if (false) { … }` keeps its whole block and its strings, and
 * with `minify: true` — which every package here uses — both vanish identically. So the `if` is not
 * asked for because the build cares.
 *
 * It is asked for because a flag with two spellings has to be read twice by everything that reads
 * it, and this repository has already paid: `dev-guard.ts` was written against the `if` alone, so
 * `listener-added-by-hand` reported dev-only code for being written the other way.
 */
describe("a `__DEV__` guard written as an operator", () => {
  test("both spellings are reported, with what the guard runs", () => {
    expect(found().map((issue) => `${issue.line} ${issue.written} ${issue.guarding}`)).toEqual([
      '15 && publish("started")',
      '17 ?: publish("again")',
      // Chained: `__DEV__ && ready && publish(…)` parses as `(__DEV__ && ready) && publish(…)`, so
      // asking whether the immediate left was the flag missed every one — while `dev-guard.ts`
      // recognised it. Both read `guardsDev` now.
      '24 && publish("chained")',
      '25 && publish("parens")',
    ]);
  });

  /**
   * The package's own annotation, which does more than silence: the reason travels into `annotated`
   * and is printed on every run, so it cannot quietly stop being true.
   */
  test("`ramonda-check-ignore` silences it and keeps the reason", () => {
    const { annotated } = run();

    expect(annotated.map((one) => one.what)).toContain("dev-guard-as-an-expression");
    expect(annotated.map((one) => one.reason)).toContain(
      "the panel handshake has to be one expression for the bundler to fold it",
    );
  });

  /**
   * `if (__DEV__ && ready)` is a conjunction INSIDE the `if` — the shape being asked for, not an
   * instance of the fault. 149 of them are written in this repository and none is reported.
   */
  test("a conjunction inside the `if` is the shape being asked for", () => {
    // Line 36 is `if (__DEV__ && ready) {`, which is the shape, not the fault.
    expect(found().map((issue) => issue.line)).not.toContain(36);
  });

  /**
   * Only where an `if` is a REPLACEMENT. A value position has none to offer, and advice that does
   * not fit the site it fires on is how a rule earns being switched off — five of these are written
   * in this repository, all in core and lens, and none is reported.
   */
  test("a value the code goes on to use is left alone", () => {
    const lines = found().map((issue) => issue.line);

    // `const label = __DEV__ ? … : ""` (44), `const armed = __DEV__ && …` (45), a JSX child (50).
    // Read off the fixture rather than guessed: the first version of this named three lines that
    // were a brace, a blank and a `return (`, so it would have passed while the rule reported every
    // value position. Only the length beside it held the line.
    for (const line of [44, 45, 50]) expect(lines).not.toContain(line);
    expect(found()).toHaveLength(4);
  });

  /**
   * A ternary with a REAL other arm is an `if`/`else`, and this rule's advice is not that.
   *
   * `__DEV__ ? publish("dev") : publish("prod")` was reported quoting only the true half, so an
   * author following the advice would delete the production one — a behaviour change in production,
   * from a rule whose own boundary is that the advice fits every site it fires on.
   */
  test("a ternary whose other arm does something is not reported", () => {
    expect(found().map((issue) => issue.line)).not.toContain(29);
  });
});

/**
 * The shapes a `__DEV__` guard is written in, asked of the rule that READS one.
 *
 * `insideADevGuard` decides whether dev-only code is dev-only, and `listener-added-by-hand` is what
 * asks it. Two shapes were missing, and both made that rule report correctly guarded code — telling
 * its author to reach for a decorator, which cannot be made dev-only at all.
 */
describe("the shapes a dev guard is written in", () => {
  const said = () =>
    (
      analyzeProject(join(here, "fixtures", "dev-guard-shapes", "tsconfig.json")).findings["listener-added-by-hand"] ??
      []
    ).map((issue) => `${issue.component}: ${issue.why}`);

  /**
   * The whole list, because the distinction is in the REASON and not in the count.
   *
   * "a decorator does it" is the report for a listener that should not be hand-rolled at all.
   * "nothing removes it" is the other claim entirely — inside a dev guard the hand-rolled call is
   * right, and the only question left is whether the hatch is closed. This fixture closes none of
   * them, so every guarded class keeps that second report and none of them keeps the first.
   */
  test("an early return and the bundler's own DEV flag are both guards", () => {
    expect(said()).toEqual([
      "GuardedByIf: nothing removes it",
      "GuardedByAnd: nothing removes it",
      // `if (!__DEV__) return;` — the shape the walk was silent on, and the one a `render()` is
      // written with far more often than a nested `if`.
      "GuardedByEarlyReturn: nothing removes it",
      // `import.meta.env.DEV` — `__DEV__` is the spelling this repository asks for, and it is not
      // the only one available. Reporting somebody's correctly guarded code over a second spelling
      // is worse than tolerating the second spelling.
      "GuardedByImportMeta: nothing removes it",
      "NotGuarded: a decorator does it",
      // The `else` of a dev guard is production, and stays reported.
      "InTheElse: a decorator does it",
    ]);
  });
});
