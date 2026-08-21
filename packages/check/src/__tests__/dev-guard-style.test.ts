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
    ]);
  });

  /**
   * `if (__DEV__ && ready)` is a conjunction INSIDE the `if` — the shape being asked for, not an
   * instance of the fault. 149 of them are written in this repository and none is reported.
   */
  test("a conjunction inside the `if` is the shape being asked for", () => {
    expect(found().map((issue) => issue.line)).not.toContain(24);
  });

  /**
   * Only where an `if` is a REPLACEMENT. A value position has none to offer, and advice that does
   * not fit the site it fires on is how a rule earns being switched off — five of these are written
   * in this repository, all in core and lens, and none is reported.
   */
  test("a value the code goes on to use is left alone", () => {
    const lines = found().map((issue) => issue.line);

    // `const label = __DEV__ ? … : ""`, `const armed = __DEV__ && …`, and a JSX child.
    for (const line of [32, 33, 38]) expect(lines).not.toContain(line);
    expect(found()).toHaveLength(2);
  });
});
