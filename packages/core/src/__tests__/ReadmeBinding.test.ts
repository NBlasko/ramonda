import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The README's account of method binding, pinned to the code's.
 *
 * It documented an opt-out that no longer exists: an underscore-prefixed method
 * "deliberately left unbound", with a performance table and a paragraph on the
 * trade — a hazard a reader would design around, for behaviour removed on
 * 2026-07-29. Reading it, you would avoid the prefix to keep `this`, or reach for
 * it to save the binding, and both conclusions were wrong.
 *
 * Documentation that describes removed behaviour is worse than none: it is
 * confident, and it costs a reader the time to disprove. Nothing catches it —
 * types, lint and tests all pass over prose — so this is the tripwire, and it
 * checks the two directions that matter: the README must not sell the opt-out,
 * and it must still agree with `bindMethods.ts` about why there isn't one.
 */
const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
const bindMethods = readFileSync(resolve(__dirname, "../helpers/bindMethods.ts"), "utf8");

describe("the README on method binding", () => {
  test("the parser is reading the section it means to", () => {
    // A guard on the instrument: if the heading moved, every assertion below would
    // pass against nothing.
    expect(readme).toContain("**Every method is bound to its instance**");
  });

  test("does not sell an opt-out the framework removed", () => {
    /**
     * The exact sentences that were there. Not a general search for "underscore",
     * which would fire on the paragraph that correctly EXPLAINS the removal.
     */
    expect(readme).not.toContain("deliberately\nleft unbound");
    expect(readme).not.toContain('is the way to say "this never travels as a callback');
    expect(readme).not.toMatch(/The one exception is an \*\*underscore-prefixed method\*\*/);
  });

  test("and the code still agrees there is none", () => {
    // If the opt-out ever comes back, this fails and the README is looked at.
    expect(bindMethods).toContain("`_`-prefixed methods are bound like any other");
    expect(readme).toContain("There is no opt-out");
  });

  test("both name the same successor, so a reader who wants one knows what to look for", () => {
    for (const source of [readme, bindMethods]) {
      expect(source).toContain("@unbound");
    }
  });
});
