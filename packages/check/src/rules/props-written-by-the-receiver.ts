import ts from "typescript";
import { positionOf } from "../syntax";
import { unwrap } from "./follow-value";
import type { Rule, RuleContext } from "./rule";

/**
 * A component or hook writing to its own `props`.
 *
 * Props belong to whoever rendered the element. The receiver gets them fresh on every render, so a
 * write is lost the moment the parent renders again — and it is lost SILENTLY, which is the part
 * that costs a day: the value is there, the next render replaces it, and nothing in between says so.
 *
 * ## It does not merely warn — it throws
 *
 * `RMD004` and `RMD015` report this at runtime, and the reports are the smaller half of what
 * happens: `core/debug/renderPhase.ts` says the write is *"stopped by the proxy, which throws in
 * every build"*. So this is not a wasteful shape that still works. It is code that cannot run.
 *
 * That is why the severity is `error` rather than the usual warning for a new rule. The test in
 * `rule.ts` is whether any version of the shape was meant, and there is none: a write that always
 * throws was never the plan.
 *
 * ## The two codes are one fault
 *
 * `RMD004` is a component's props, `RMD015` a hook's, and the runtime reports them separately only
 * because the two proxies are installed in different places. From the source they are the same
 * sentence — so this is one rule that answers both, declared as a pair.
 *
 * ## What is NOT reported
 *
 * **Mutating something the props POINT AT.** `this.props.meta.seen = true` sets a key on `meta`,
 * not on `props`, so the proxy never sees it and it does not throw. It is a real fault of a
 * different kind — writing into an object the parent owns — and calling it this one would report a
 * throw that does not happen.
 *
 * **A destructured value.** `let { label } = this.props; label = "x"` writes a local. Nothing of
 * the component's changed and nothing throws.
 *
 * **Reading**, which is the whole purpose of props.
 *
 * **Another object called `props`.** The name is not the subject; `this.props` is, and a local
 * alias for it is followed because the proxy guards the object rather than the path taken to it.
 */
export interface PropsWrittenByTheReceiverIssue {
  /** The class doing the writing, which is what the report names. */
  component: string;
  /** The prop, as written — a computed key is quoted as it appears rather than guessed at. */
  prop: string;
  /** `assign`, `delete` or `step`: three spellings of one fault, and the advice is the same. */
  how: "assign" | "delete" | "step";
  file: string;
  line: number;
  column: number;
}

/** Whether this expression IS the component's props bag — directly, or through a local for it. */
function isProps(written: ts.Expression, resolve: RuleContext["resolve"]): boolean {
  // A cast is not a defence: `(this.props as { n: number }).n++` writes the same object.
  const node = unwrap(written);
  if (ts.isPropertyAccessExpression(node)) {
    return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === "props";
  }
  // One hop. `const p = this.props` is the same object, and the proxy guards the object.
  if (!ts.isIdentifier(node)) return false;
  const declaration = resolve(node)?.declarations?.[0];
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
  return declaration.initializer !== undefined && isProps(declaration.initializer, resolve);
}

/** The prop a write lands on, or `undefined` when the target is not a key of the props bag. */
function propWritten(written: ts.Expression, resolve: RuleContext["resolve"]): string | undefined {
  const target = unwrap(written);
  if (ts.isPropertyAccessExpression(target)) {
    return isProps(target.expression, resolve) ? target.name.text : undefined;
  }
  if (ts.isElementAccessExpression(target)) {
    if (!isProps(target.expression, resolve)) return undefined;
    const key = target.argumentExpression;
    return ts.isStringLiteralLike(key) ? key.text : key.getText();
  }
  return undefined;
}

export const propsWrittenByTheReceiver = {
  id: "props-written-by-the-receiver",

  report: {
    severity: "error",
    reportedWhen:
      "a component or hook assigns to its own `props` — the write throws in every build, and the value belonged to whoever rendered the element",
    alsoReportedAs: ["RMD004", "RMD015"],
    heading: (found) => `${found.length} write(s) to props the component does not own:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component} /> ${
        issue.how === "delete" ? "deletes" : issue.how === "step" ? "increments" : "assigns to"
      } \`props.${issue.prop}\`, which throws — the value belongs to whoever rendered it.`,
    ],
    advice:
      "Props are the parent's. The receiver is handed them fresh on every render, so a write would\n" +
      "be replaced the next time the parent rendered even if it were allowed — and it is not: the\n" +
      "props bag is a proxy that THROWS on a write, in every build, not only in development.\n\n" +
      "What the write was probably for, and where it goes instead:\n\n" +
      "A value this component owns and changes is `@state`. A value derived from a prop is a\n" +
      "`@compute`, which recomputes when the prop changes instead of being overwritten by the next\n" +
      "render. A value the PARENT should change is a callback prop the parent passes down — the\n" +
      "child asks, the parent decides, and the new value arrives as a prop.\n\n" +
      "Mutating something the props point at — `this.props.rows.push(…)` — is NOT this report, and\n" +
      "not because it is fine: it is an object the parent owns, changed behind its back, and no\n" +
      "proxy is watching. It simply is not the write this rule can prove.",
  },

  read(cls, { self, resolve }) {
    const found: PropsWrittenByTheReceiverIssue[] = [];

    const record = (target: ts.Expression, how: PropsWrittenByTheReceiverIssue["how"], at: ts.Node): void => {
      const prop = propWritten(target, resolve);
      if (prop === undefined) return;
      found.push({ component: self.name, prop, how, ...positionOf(at) });
    };

    (function walk(node: ts.Node): void {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        record(node.left, "assign", node);
      } else if (ts.isDeleteExpression(node)) {
        record(node.expression, "delete", node);
      } else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        record(node.operand as ts.Expression, "step", node);
      }
      ts.forEachChild(node, walk);
    })(cls);

    return found;
  },
} as const satisfies Rule<PropsWrittenByTheReceiverIssue>;
