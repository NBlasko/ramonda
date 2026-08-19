import ts from "typescript";
import { importedFromCore } from "./core-import";
import type { RuleContext } from "./rule";

/**
 * Which `createContext` pair a name belongs to, and which half of it.
 *
 * Shared rather than copied because two rules now turn on it, and they turn on it for the same
 * reason: `const [P, C] = createContext(…)` is usually declared in another module and imported, so
 * the only provable way to say "these two names are one context" is the DECLARATION they came from.
 * Going by name would report a reader's own `ThemeProvider`, and going by shape would confuse two
 * contexts that happen to hold the same keys.
 *
 * `context-consumed-above-its-provider` asks which half; `one-provider-per-component` asks how many
 * of the first half one class holds. Both need exactly this, and neither may guess.
 */

/** One half of a `createContext` pair, as a rule can prove it. */
export interface ContextHalf {
  /** The `VariableDeclaration` the pair was destructured from — two halves of one context share it. */
  pair: ts.VariableDeclaration;
  /** 0 is the Provider, 1 is the Consumer. Nothing else is a half. */
  index: number;
  /** The binding's own name, which is what a report calls it. */
  name: string;
  /** `createContext(…, { label })`, when the author gave one. */
  label?: string;
}

/** The `label` in `createContext(default, { label: "Theme" })`, when it is a plain string. */
function labelOf(call: ts.CallExpression): string | undefined {
  const options = call.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const named = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
    if (named !== "label") continue;
    const value = property.initializer;
    return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
  }
  return undefined;
}

/**
 * Which half of which context a name refers to, or `undefined` when that cannot be proved.
 *
 * Through the DECLARATION rather than the name: `resolve` follows an import alias to the
 * `BindingElement` it came from, so two names refer to one context when they share the
 * `VariableDeclaration`.
 *
 * Everything else goes quiet, by the rule this package is held to. `const pair = createContext(…)`
 * read as `pair[0]` has no binding element; a Provider wrapped in a hook class of its own — the way
 * `QueryClientProvider` wraps one — is a class and not a binding at all. Neither is judged.
 */
export function contextHalfOf(name: ts.Expression, context: RuleContext): ContextHalf | undefined {
  if (!ts.isIdentifier(name)) return undefined;
  const declaration = context.resolve(name)?.declarations?.[0];
  if (declaration === undefined || !ts.isBindingElement(declaration)) return undefined;

  const pattern = declaration.parent;
  if (!ts.isArrayBindingPattern(pattern)) return undefined;
  const variable = pattern.parent;
  if (!ts.isVariableDeclaration(variable)) return undefined;

  const initializer = variable.initializer;
  if (initializer === undefined || !ts.isCallExpression(initializer)) return undefined;

  // `createContext` by the module it came from, not by its name — an app is entitled to a function
  // of its own called that, and reporting it would be reporting the reader's own code.
  const callee = initializer.expression;
  if (!importedFromCore(callee, context.resolveLocal)) return undefined;
  if (!ts.isIdentifier(callee) || callee.text !== "createContext") return undefined;

  const index = pattern.elements.indexOf(declaration);
  if (index !== 0 && index !== 1) return undefined;

  const label = labelOf(initializer);
  return { pair: variable, index, name: name.text, ...(label === undefined ? {} : { label }) };
}
