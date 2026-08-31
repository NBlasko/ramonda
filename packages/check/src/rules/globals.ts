import ts from "typescript";
import type { Resolver } from "./rule";

/**
 * Whether an identifier names the global object — `globalThis`, `window`, `document`, `self`,
 * `global`.
 *
 * Written once because five rules ask it and each asked it differently, which is answers waiting to
 * disagree about one line. Two spellings of the question were tried before this one and both were
 * wrong, in opposite directions:
 *
 * - **By NAME alone** reported a real binding. Measured: `const self = this; self.location.pathname`
 *   came out as a read of the browser's URL on a component reading its own field, and
 *   `(self) => …` is this framework's own convention for a decorator's props callback.
 * - **Requiring it to resolve to NOTHING** silenced whatever a project declares for itself.
 *   `globalThis` always resolves, so every listener written on it went unreported; and a project
 *   that writes `declare const self: Window` — an ordinary line in a worker or an SSR entry — would
 *   have turned off three rules at once.
 *
 * ## What separates them is AMBIENT versus real
 *
 * The analyzer forces `noLib: true, types: []` whatever the project's own tsconfig says, so a
 * global the DOM library declares can never resolve here. The only thing that can is a declaration
 * in the project's own source — and those come in two kinds. `declare const document: Document` is
 * the author writing down what the platform already provides, which is still the platform's. `const
 * self = this`, or a parameter called `window`, is a name of their own that happens to collide.
 *
 * So: the name, unless something in the source declares it FOR REAL. That is one test for all five,
 * it needs no list of exceptions, and it is what `dom-writes` was reaching for when it argued that
 * a prefix is not a form a local plausibly shadows — its own fixture declares `document`
 * ambiently, and that is why the by-name rule looked right there.
 */
const NAMES: ReadonlySet<string> = new Set(["globalThis", "window", "document", "self", "global"]);

export function isTheGlobal(node: ts.Expression, resolve: Resolver): boolean {
  if (!ts.isIdentifier(node) || !NAMES.has(node.text)) return false;
  return !declaredForReal(node, resolve);
}

/**
 * Whether the source declares this name itself, as a binding rather than as an ambient note.
 *
 * A `.d.ts` is ambient by definition, and so is anything under a `declare` — which
 * `getCombinedModifierFlags` answers for a `VariableDeclaration` by reading the statement it
 * belongs to. Everything else is somebody's own `const`, `let`, parameter or field, and a name they
 * chose is not the global however it is spelled.
 */
function declaredForReal(node: ts.Identifier, resolve: Resolver): boolean {
  return (resolve(node)?.declarations ?? []).some(
    (declaration) =>
      (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient) === 0 &&
      !declaration.getSourceFile().isDeclarationFile,
  );
}
