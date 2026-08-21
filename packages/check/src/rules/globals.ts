import ts from "typescript";
import type { Resolver } from "./rule";

/**
 * Whether an identifier names the global object — `window`, `document`, `self`, `globalThis`.
 *
 * Written once because three rules ask it and each asked it differently, which is two answers
 * waiting to disagree about one line. `browser-url` accepted all four by NAME, `listener-added-by-
 * hand` required all four to resolve to nothing, and `server-env-in-shared-code` special-cased
 * `globalThis`. Two of the three were wrong, in opposite directions:
 *
 * - **`self` by name is a false report.** `const self = this` is an ordinary line and `(self) => …`
 *   is this framework's own convention for a `@Host` props callback, so `self.location.pathname`
 *   was reported as the browser's URL on a component reading its own field. Measured.
 * - **`globalThis` behind the resolve test is a silence.** The checker knows that name whatever the
 *   lib settings are, so it always resolves and the test rejects every one of them.
 *
 * The rule that comes out of both: a name the source can shadow has to be PROVED not to be, and
 * `globalThis` cannot be shadowed — it is a reserved binding, not a global anyone can declare over.
 *
 * "Proved not to be" is the analyzer's usual trick and costs no type: the program is built with
 * `noLib` and no `@types`, so the browser's own `window` has no declaration to find while a
 * `const window = …` in the source has one.
 */
const SHADOWABLE: ReadonlySet<string> = new Set(["window", "document", "self", "global"]);

export function isTheGlobal(node: ts.Expression, resolve: Resolver): boolean {
  if (!ts.isIdentifier(node)) return false;
  if (node.text === "globalThis") return true;
  return SHADOWABLE.has(node.text) && resolve(node) === undefined;
}
