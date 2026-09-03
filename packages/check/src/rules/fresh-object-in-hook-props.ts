import ts from "typescript";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import { hasDecorator, heritage } from "./render-reach";
import { freshnessOf, shorten } from "./follow-value";
import { stablePropsOf } from "./fresh-object-in-props";
import type { Rule, RuleContext } from "./rule";

/**
 * An object or array literal written into a HOOK's props — a context value, above all.
 *
 * `fresh-object-in-props` is the same fault where a parent writes it in JSX. This is where a
 * component writes it for a hook: `this.use(ThemeProvider, () => ({ conf: { dense: true } }))`.
 * Every prop is a signal, so a rebuilt object is a CHANGED prop — and for a Provider that means
 * every consumer of that key wakes, however far down the tree it sits and however unchanged the
 * contents are.
 *
 * ## Measured, not reasoned about
 *
 * A provider with two keys and a consumer reading only the first, counting the CONSUMER's renders
 * while the OTHER key moves three times:
 *
 * | the factory | renders after mount | after three unrelated changes |
 * |---|---|---|
 * | `() => ({ conf: { dense: true }, tick: this.tick })` | 1 | **4** |
 * | with `@StableProps("conf")` on the provider | 1 | **1** |
 * | `() => ({ conf: { dense: true }, tick: 0 })` — reads nothing | 1 | **1** |
 *
 * ## The third row is the whole of when this fires
 *
 * The props callback is CACHED on the signals it read: one that reads none is called once, at
 * mount, and a literal inside it then keeps one identity for the life of the component — which is
 * not a fault at all and must not be reported. So this asks two things, and needs both: a literal
 * among the props, and a REACTIVE read somewhere in the callback that can make it run again.
 *
 * A reactive read is `@state` or `@compute` on this class or a base, anything under `this.props`,
 * or a field holding another hook — all four measured. A read this cannot classify answers "not
 * reactive", which is silence, which is the contract.
 *
 * ## What is deliberately NOT reported
 *
 * **A key the hook DECLARED with `@StableProps`.** The same reason the JSX rule skips one: the
 * declaration is the answer to this report. Read through the hook's class chain, resolved rather
 * than matched by name.
 *
 * **A hook whose class this cannot see** — one reached through a `.d.ts`, which is every installed
 * package. Declaration files carry no decorators, so `@StableProps` on `Query` is invisible from
 * outside its own source: reporting there would report the fix and there would be no way to tell.
 * `@ramonda/query` declares `key` and `invalidates` exactly this way.
 *
 * **A key written before a spread**, which may overwrite it, and **a factory whose body this cannot
 * read** — anything but an arrow or a function expression written at the call site.
 */
export interface FreshObjectInHookPropsIssue {
  /** The class writing the `use`, which is where the reader has to go. */
  component: string;
  /** The hook it is handed to, as written. */
  hook: string;
  /** The prop's name. */
  prop: string;
  kind: "object" | "array";
  /** How it is written, so the report quotes the line rather than a shape. */
  written: string;
  /** Where it is built, when that is not this line. */
  builtIn: string | undefined;
  /** What makes the callback run again — the read that keeps this from being a one-off. */
  rebuiltBecauseOf: string;
  file: string;
  line: number;
  column: number;
}

/**
 * A read that can make the props callback run again.
 *
 * The callback is cached on the signals it read, so this is the difference between a literal built
 * once at mount — which is correct, and is what `apps/playground-core` relies on — and one rebuilt
 * whenever anything the callback touches moves.
 *
 * Answers the read as WRITTEN, because the report has to name it: "rebuilt whenever `this.theme`
 * changes" is a sentence a reader can act on, where "it is reactive" is not.
 */
function reactiveReadIn(body: ts.Node, cls: ts.ClassDeclaration, resolve: RuleContext["resolve"]): string | undefined {
  const reactive = new Set<string>();
  // The class ITSELF and then its bases: `heritage` answers the chain ABOVE a class, and reading
  // only that found nothing at all — a component's own `@state` is where this fires most.
  for (const declaration of [cls, ...heritage(cls, resolve)]) {
    for (const member of declaration.members) {
      if (member.name === undefined || !ts.isIdentifier(member.name)) continue;

      // A `@compute` is written as a GETTER, which is not a property declaration.
      if (hasDecorator(member, "state", resolve) || hasDecorator(member, "compute", resolve)) {
        reactive.add(member.name.text);
        continue;
      }

      // A field holding another hook: its own props and state are signals too, and a callback
      // reading one re-runs when they move — measured, three unrelated changes, three re-runs.
      if (!ts.isPropertyDeclaration(member)) continue;
      const initializer = member.initializer;
      if (initializer !== undefined && ts.isCallExpression(initializer) && isThisUse(initializer)) {
        reactive.add(member.name.text);
      }
    }
  }

  let found: string | undefined;
  (function look(node: ts.Node): void {
    if (found !== undefined) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(node.name)
    ) {
      // Every prop is a signal, so any read under `this.props` counts — named down to the prop
      // itself when one is written, because "this.props changes" is not a sentence anyone can act
      // on and `this.props.id` is.
      if (node.name.text === "props") {
        const parent = node.parent;
        found =
          ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? `this.props.${parent.name.getText()}`
            : "a prop";
        return;
      }
      if (reactive.has(node.name.text)) {
        found = `this.${node.name.text}`;
        return;
      }
    }
    ts.forEachChild(node, look);
  })(body);

  return found;
}

/** The props bag a callback hands back, when it hands back one this can read. */
function bagOf(factory: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return undefined;

  const body = factory.body;
  if (!ts.isBlock(body)) {
    const returned = ts.isParenthesizedExpression(body) ? body.expression : body;
    return ts.isObjectLiteralExpression(returned) ? returned : undefined;
  }

  let found: ts.ObjectLiteralExpression | undefined;
  (function look(node: ts.Node): void {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const returned = ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression;
      if (ts.isObjectLiteralExpression(returned)) found = returned;
      return;
    }
    ts.forEachChild(node, look);
  })(body);
  return found;
}

/**
 * Whether the hook's own source is in front of us.
 *
 * A `.d.ts` carries no decorators, so `@StableProps` on an installed hook cannot be seen from
 * outside the package that wrote it — and a rule that cannot tell a missing declaration from an
 * invisible one may not report either.
 */
function declarationIsReadable(hook: ts.Expression, resolve: RuleContext["resolve"]): boolean {
  const declaration = resolve(hook)?.declarations?.[0];
  if (declaration === undefined) return false;
  const file = declaration.getSourceFile();
  return !file.isDeclarationFile && !file.fileName.includes("node_modules");
}

export const freshObjectInHookProps = {
  id: "fresh-object-in-hook-props",

  report: {
    severity: "error",
    reportedWhen:
      "a hook — a context Provider above all — is handed an object or array built inside its props callback, where the callback also reads something reactive, so the value is rebuilt and every consumer of that key wakes with contents that did not change",
    alsoReportedAs: "RMD022",
    heading: (found) => `${found.length} hook prop(s) rebuilt when the callback runs again:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> gives ${issue.hook} a new ${issue.kind} for \`${issue.prop}\`${
        issue.builtIn === undefined ? "" : `, built in ${issue.builtIn}`
      }, every time ${issue.rebuiltBecauseOf} changes — so everything reading \`${issue.prop}\` wakes with contents that did not move.`,
    ],
    advice:
      "A hook's props are signals, so a rebuilt object is a CHANGED prop. For a context Provider\n" +
      "that reaches every consumer of the key, however far down the tree it sits: measured, a\n" +
      "consumer reading one key rendered four times over three changes to a DIFFERENT key.\n\n" +
      "The callback itself is not the problem — it is cached on the signals it reads, and one that\n" +
      "reads none is called once at mount, so a literal inside it keeps one identity forever. This\n" +
      "is reported only where the callback also reads something that can make it run again.\n\n" +
      "The fix is on the HOOK, which is the thing that knows whether a prop is a value or an\n" +
      'identity: `@StableProps("conf")`. The framework then hands back the identity it already had\n' +
      "while the contents match, and consumers stay asleep.\n\n" +
      "A context Provider is not a class you wrote, so it takes the declaration where the context is\n" +
      "CREATED:\n\n" +
      "    const [ConfProvider, ConfConsumer] = createContext(\n" +
      "      { conf: { dense: false } },\n" +
      '      { stableProps: ["conf"] },\n' +
      "    );\n\n" +
      "Or move the value out of the callback entirely — a `@compute` gives you the same object back\n" +
      "until something it reads changes, which is exactly what a consumer needs.\n\n",
  },

  read(cls, { self, resolve }) {
    const found: FreshObjectInHookPropsIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      const call = member.initializer;
      if (call === undefined || !ts.isCallExpression(call) || !isThisUse(call)) continue;
      if (call.arguments.length < 2) continue;

      const hook = hookNamed(call.arguments[0]);
      const bag = bagOf(call.arguments[1]);
      if (bag === undefined) continue;
      if (!declarationIsReadable(hook, resolve)) continue;

      const settled = stablePropsOf(hook, resolve);
      // Everything up to the last spread may be overwritten by it, exactly as in JSX.
      const lastSpread = bag.properties.reduce(
        (at, property, index) => (ts.isSpreadAssignment(property) ? index : at),
        -1,
      );

      let rebuiltBecauseOf: string | undefined;

      for (const [index, property] of bag.properties.entries()) {
        if (index < lastSpread) continue;

        const name = property.name;
        if (name === undefined || !ts.isIdentifier(name)) continue;
        if (settled.has(name.text)) continue;

        const written = ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
        if (written === undefined) continue;

        const built = freshnessOf(written, resolve, 0);
        if (built === undefined) continue;

        // Asked once per `use`, and only once a literal has been found — the walk costs more than
        // the question it answers, and most callbacks hold no literal at all.
        rebuiltBecauseOf ??= reactiveReadIn(call.arguments[1], cls, resolve) ?? "";
        if (rebuiltBecauseOf === "") break;

        found.push({
          component: self.name,
          hook: hook.getText(),
          prop: name.text,
          kind: built.kind,
          written: shorten(written),
          builtIn: built.builtIn,
          rebuiltBecauseOf,
          ...positionOf(property),
        });
      }
    }

    return found;
  },
} as const satisfies Rule<FreshObjectInHookPropsIssue>;
