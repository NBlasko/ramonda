import ts from "typescript";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import { importedFromCore } from "./core-import";
import type { Rule, RuleContext } from "./rule";

/**
 * A context consumed on a line ABOVE the Provider that publishes it on the same component.
 *
 * A component publishes a context on its own object, and a consumer resolves its channel ONCE, in
 * its constructor. Hooks are constructed in field-declaration order — so a consumer written above
 * the provider looked before the provider existed, and reads the nearest provider on an ANCESTOR
 * instead, or the context's default if there is none.
 *
 * ```tsx
 * before = this.use(ThemeConsumer);                     // the ancestor's value
 * own    = this.use(ThemeProvider, () => ({ … }));
 * ```
 *
 * Two field declarations decide what the page shows, and swapping them is the kind of edit a
 * formatter, a merge or a tidy-up makes without anyone reading it as a change.
 *
 * **Only this order.** The other one — provider first, then consumer — is `this.use(QueryClientProvider)`
 * followed by `this.use(Query, …)`: mount a client, then query on it, which is the arrangement
 * `@ramonda/query` and `@ramonda/router` are built around. Reporting it was measured at **14 hits
 * across query's own tests**, every one on the documented pattern.
 *
 * **What this rule can see that RMD057 cannot, and the other way round.** This speaks before anything
 * runs, including for a component down a branch nobody has opened. It only sees a pair written
 * DIRECTLY — `const [P, C] = createContext(…)` and both halves handed to `this.use` in the same
 * class — because that is what it can prove; a provider wrapped in a hook of its own, the way
 * `QueryClientProvider` wraps one, is invisible here and is exactly what the runtime diagnostic
 * catches.
 */
export interface ContextConsumedAboveItsProviderIssue {
  /** The class holding both halves. */
  component: string;
  /** The context's label when it has one, else the consumer binding's name. */
  context: string;
  /** The binding name as this class wrote it, so a reader can find the line. */
  consumer: string;
  /** The provider binding's name, and the line it is declared on. */
  provider: string;
  providerAtLine: number;
  /** The CONSUMER's position — the line that reads the value the author did not expect. */
  file: string;
  line: number;
  column: number;
}

/** One half of a `createContext` pair, as this rule can prove it. */
interface Half {
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
 * Through the DECLARATION rather than the name, which is the whole reason this is provable: the pair
 * is usually declared in another file and imported, and `resolve` follows the alias to the
 * `BindingElement` it came from. Two names refer to one context when they share the
 * `VariableDeclaration` — not when they spell the same word, and not when they are the same shape.
 *
 * Everything else goes quiet, by the rule this package is held to. `const pair = createContext(…)`
 * read as `pair[0]` has no binding element; a Provider wrapped in a hook class is a class and not a
 * binding at all. Neither is judged here.
 */
function halfOf(name: ts.Expression, context: RuleContext): Half | undefined {
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

export const contextConsumedAboveItsProvider = {
  id: "context-consumed-above-its-provider",

  report: {
    // A warning, and for once not only because the repository starts every rule as one. The
    // arrangement has a legitimate reading — read the outer value and provide a derived one, which
    // works ONLY in this order — as well as a mistake, and nothing static can tell them apart. So it
    // says what it found rather than failing the build over it.
    severity: "warn",
    reportedWhen:
      "a component consumes a context on a line above the Provider that publishes it, so the consumer reads an ancestor's value",
    alsoReportedAs: "RMD057",
    heading: (found) => `${found.length} context(s) consumed above the provider on the same component:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> — \`${issue.consumer}\` resolves before \`${issue.provider}\` on line`,
      `    ${issue.providerAtLine} publishes "${issue.context}", so it reads an ancestor's value.`,
    ],
    advice:
      "A consumer resolves its channel ONCE, when it is constructed, and hooks are constructed in\n" +
      "field-declaration order. So a consumer above the provider on its own component looked before\n" +
      "that provider existed, and reads the nearest one on an ANCESTOR instead — or the context's\n" +
      "default, if there is none.\n\n" +
      "If this component's own value was meant, read it through the PROVIDER hook rather than a\n" +
      "consumer: a Provider reads as well as provides, so `this.theme.color` where `theme` is the\n" +
      "Provider always means this component's value and does not depend on the order. Moving the\n" +
      "provider above the consumer works too, and leaves the answer resting on which line is first.\n\n" +
      "If the value from ABOVE was meant — reading the outer theme to derive an inner one — then this\n" +
      "is that arrangement working, and the order it needs is the order it has. Nothing else in the\n" +
      "source says which of the two it is, which is why this is reported rather than failed.\n\n" +
      "The other order is not reported: `this.use(QueryClientProvider)` followed by\n" +
      "`this.use(Query, …)` is mount-a-client-then-query-on-it, and that is what the packages do.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, context) {
    const found: ContextConsumedAboveItsProviderIssue[] = [];

    /** Per context, the first half of each kind this class declares, and the FIELD that declared it. */
    type Declared = Half & { at: ts.PropertyDeclaration };
    const seen = new Map<ts.VariableDeclaration, { provider?: Declared; consumer?: Declared }>();

    /**
     * FIELD initializers only, in the order they are written — because that is the order the hooks
     * are constructed in, and the order is the whole question. A `this.use` inside a method runs
     * when the method is called, which this cannot place relative to a field, so it is not counted.
     */
    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isThisUse(node)) {
          const named = node.arguments[0];
          const half = named === undefined ? undefined : halfOf(hookNamed(named), context);
          if (half !== undefined) {
            const entry = seen.get(half.pair) ?? {};
            // The FIRST of each kind. A second provider on one component is its own fault (RMD056),
            // and taking the first here keeps this rule answering only its own question.
            if (half.index === 0) entry.provider ??= { ...half, at: member };
            else entry.consumer ??= { ...half, at: member };
            seen.set(half.pair, entry);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(member.initializer);
    }

    for (const { provider, consumer } of seen.values()) {
      if (provider === undefined || consumer === undefined) continue;
      // Both halves on one component, and the consumer first. The other way round is the arrangement
      // the packages are built around and is deliberately silent. Compared by POSITION in the source
      // rather than by line, so two on one line still have an order.
      if (consumer.at.getStart() >= provider.at.getStart()) continue;
      found.push({
        component: context.self.name,
        context: consumer.label ?? consumer.name,
        consumer: consumer.name,
        provider: provider.name,
        providerAtLine: positionOf(provider.at).line,
        // The CONSUMER's field, not the `this.use` inside it — the field is the line a reader moves.
        ...positionOf(consumer.at),
      });
    }

    return found;
  },
} as const satisfies Rule<ContextConsumedAboveItsProviderIssue>;
