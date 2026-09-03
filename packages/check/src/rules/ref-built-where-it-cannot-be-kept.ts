import ts from "typescript";
import { positionOf } from "../syntax";
import { importedFromPackage } from "./core-import";
import { walkRenders } from "./render-reach";
import type { Rule, RuleContext } from "./rule";

/**
 * `createRef()` called from somewhere its answer cannot be kept.
 *
 * A ref is an IDENTITY: you keep it and read `current` later. `createRef()` returns a NEW object
 * every call, so one built inside a render, a `@compute`, a `@memoized` member or a hook's props
 * callback is a different ref on every pass — and two things follow.
 *
 * The child is handed a changed `ref` on every parent render. That IS a props change: core compares
 * `ref` like any other prop, and `helpers/arePropsBagsEqual.ts` says why it did not always. So the
 * child re-renders for nothing, once per parent render, for as long as the page lives.
 *
 * And the ref the author meant to read is replaced before they can read it. Nothing kept a
 * reference to it, so `current` is read off an object the next render already threw away.
 *
 * ## Why a rule when the framework reports it
 *
 * `RMD061` fires when the line RUNS, and a ref built in a branch nobody has rendered stays quiet
 * until somebody does. This one fires on the line as it is typed — the pairing
 * {@link Report.alsoReportedAs} exists for.
 *
 * ## Where it looks, and where it does not
 *
 * Everything a render or a `@compute` REACHES, which is `render-reach`'s walk and therefore includes
 * a `@memoized` member the render calls, a helper two files away, and a base class's method. Plus
 * every `this.use(Hook, () => …)` callback written at the call site, which the walk does not reach
 * because it lives in a field initializer.
 *
 * A `@memoized` member nothing calls from a render is NOT reported, and that is the same answer the
 * runtime gives: a phase that never runs cannot build a ref. Neither is `createRef` from anywhere
 * else — a field, `@created`, an event handler, module scope — because that is where it belongs.
 *
 * Judged by where the binding came from, never by the name: an app is entitled to a `createRef` of
 * its own, and one judged by these semantics would be reported for somebody else's rules.
 */
export interface RefBuiltWhereItCannotBeKeptIssue {
  /** The component or hook the call was reached from. */
  component: string;
  /** How it was reached — `render → rowFor`, or the hook the props callback belongs to. */
  through: readonly string[];
  file: string;
  line: number;
  column: number;
}

/** Whether this call is the framework's `createRef`, by where the binding came from. */
function isCreateRef(node: ts.Node, context: Pick<RuleContext, "resolve" | "resolveLocal" | "resolveStep">): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isIdentifier(callee)) return false;
  return importedFromPackage(callee, "@ramonda/core", context.resolveLocal, context.resolveStep, "createRef");
}

/**
 * The `this.use(Hook, () => …)` callbacks written at the call site.
 *
 * A hook's props callback runs whenever the signals it read change, so a `createRef()` inside one is
 * rebuilt on somebody else's state change — the same fault, reached a different way. It is not part
 * of the render walk because it is written in a FIELD INITIALIZER, which is exactly where a ref is
 * supposed to live; only the callback handed to `use` is in scope here.
 */
function propsCallbacks(cls: ts.ClassDeclaration): { hook: string; body: ts.Node }[] {
  const found: { hook: string; body: ts.Node }[] = [];

  const look = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "use" &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const [hook, factory] = node.arguments;
      if (
        hook !== undefined &&
        factory !== undefined &&
        (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))
      ) {
        found.push({ hook: ts.isIdentifier(hook) ? hook.text : "a hook", body: factory.body });
      }
    }
    ts.forEachChild(node, look);
  };
  look(cls);

  return found;
}

export const refBuiltWhereItCannotBeKept = {
  id: "ref-built-where-it-cannot-be-kept",

  report: {
    /**
     * A warning, and not because the fault is mild: the page renders correctly and pays a render it
     * did not need, while the ref the author wanted is unreadable. It becomes an error in a later
     * version, which is how every new rule here starts.
     */
    severity: "warn",
    reportedWhen:
      "`createRef()` is called from a render, a `@compute`, a `@memoized` member a render calls, or a hook's props callback — so it answers a new identity every pass, the child re-renders for a `ref` that only looks changed, and nothing can read `current`",
    alsoReportedAs: "RMD061",
    heading: (found) => `${found.length} ref(s) built where the identity cannot be kept:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> builds a ref in ${issue.through.join(" → ")} — a new one every pass.`,
    ],
    advice:
      "A ref is an identity, so it belongs where an identity belongs: a FIELD.\n\n" +
      "    class Editor extends Component {\n" +
      "      private field = createRef<HTMLTextAreaElement>();\n\n" +
      "      render() {\n" +
      "        return <TextArea value={this.text} ref={this.field} />;\n" +
      "      }\n" +
      "    }\n\n" +
      "A CALLBACK belongs on a field too — `createRef<T>((node) => this.arrived(node))` is how\n" +
      "`Select` and `TextArea` learn their element has appeared. What must not move is the ref\n" +
      "itself.\n\n" +
      "Built in a render instead, it is a new object every pass. `ref` is compared like every other\n" +
      "prop, so the child re-renders once per parent render for a change that is not one — and\n" +
      "`current` is read off an object the next render has already replaced.",
  },

  read(cls, context) {
    const { self, resolve } = context;
    const found: RefBuiltWhereItCannotBeKeptIssue[] = [];

    walkRenders(cls, {
      resolve,
      visit(node, through) {
        if (!isCreateRef(node, context)) return;
        found.push({ component: self.name, through: [...through], ...positionOf(node) });
      },
    });

    for (const { hook, body } of propsCallbacks(cls)) {
      const look = (node: ts.Node): void => {
        if (isCreateRef(node, context)) {
          found.push({
            component: self.name,
            through: [`${hook}'s props`],
            ...positionOf(node),
          });
        }
        ts.forEachChild(node, look);
      };
      look(body);
    }

    return found;
  },
} as const satisfies Rule<RefBuiltWhereItCannotBeKeptIssue>;
