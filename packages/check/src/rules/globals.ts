import ts from "typescript";
import type { Resolver } from "./rule";

/**
 * Whether an identifier names the global object — `window`, `document`, `self`, `globalThis`.
 *
 * Written once because five rules ask it and each asked it differently, which is answers waiting to
 * disagree about one line. The answer is ASYMMETRIC, and every part of it is a measurement or a
 * decision already argued somewhere in this package.
 *
 * **`globalThis` is always the global.** The checker knows that name whatever the lib settings are,
 * so a "resolves to nothing" test rejects every one of them — `listener-added-by-hand` required it
 * and was silent on every listener written that way. It is a reserved binding, not a global anyone
 * can declare over.
 *
 * **`window` and `document` count by NAME, as a prefix.** `dom-writes` argued this first and it
 * holds: nobody writes `const document = …` and then reaches for `.body.classList`. Requiring them
 * to resolve to nothing makes a rule depend on the run having no lib — true for this analyzer today,
 * and a silent trap for a project that declares the global itself.
 *
 * **`self` and `global` have to prove themselves.** `self` is the one of the four that is routinely
 * a local: `const self = this` is an ordinary line, and `(self) => …` is this framework's own
 * convention for a `@Host` props callback. Accepted by name it reported `self.location.pathname` on
 * a component reading its own field — measured, in `fixtures/browser-url`.
 *
 * "Proved not to be" costs no type: the program is built with `noLib` and no `@types`, so a name
 * the browser owns has no declaration to find while a `const self = …` in the source has one.
 */
const ALWAYS: ReadonlySet<string> = new Set(["globalThis", "window", "document"]);
const MUST_PROVE_IT: ReadonlySet<string> = new Set(["self", "global"]);

export function isTheGlobal(node: ts.Expression, resolve: Resolver): boolean {
  if (!ts.isIdentifier(node)) return false;
  if (ALWAYS.has(node.text)) return true;
  return MUST_PROVE_IT.has(node.text) && resolve(node) === undefined;
}
