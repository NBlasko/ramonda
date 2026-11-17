import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { heritage } from "./render-reach";
import type { Rule } from "./rule";

/**
 * A method of a component or hook, written over — `this.submit = somethingElse`.
 *
 * A method is part of what the class IS, and the framework reads it that way. A hook's props
 * callback that hands one over — `this.use(Form, () => ({ onSubmit: this.submit }))` — reads no
 * signal, so it runs once and never again, and in a production build the hook is not even walked:
 * a write to `this.submit` afterwards reaches nobody. Measured before this rule existed: the hook
 * kept calling the first function, in both builds, while the component held the second.
 *
 * Refused everywhere in the class, not only where a cached reader reads the name. Every write is
 * the same act — the constructor's included, because a field initializer calls `this.use` and the
 * props callback before the constructor body runs. And the answer has one shape whatever the
 * reason was: a value that changes is `@state`, and a method that decides between two behaviours
 * reads that state.
 *
 * Writes from OUTSIDE the class — `row.submit = x` on an instance somewhere else — are not
 * reachable here: this package asks where names are declared, never what type a value has.
 */
export interface MethodWrittenOverIssue {
  /** The component or hook. */
  component: string;
  /** The method written over. */
  method: string;
  /** The member the write is in. */
  writtenIn: string;
  file: string;
  line: number;
  column: number;
}

/** The instance methods a class has, its bases' included. */
function methodsOf(declaring: readonly ts.ClassLikeDeclaration[]): Set<string> {
  const methods = new Set<string>();
  for (const one of declaring) {
    for (const member of one.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
      const name = memberName(member);
      if (name !== undefined) methods.add(name);
    }
  }
  return methods;
}

export const methodWrittenOver = {
  id: "method-written-over",

  report: {
    severity: "error",
    reportedWhen: "a component or hook assigns to one of its own methods, which a cached reader never sees",
    heading: (found) => `${found.length} method(s) written over:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.writtenIn}\` assigns \`this.${issue.method}\`, which is a method.`,
    ],
    advice:
      "A hook's props callback that hands a method over — `() => ({ onSubmit: this.submit })` — reads\n" +
      "no signal, so it runs once and the hook keeps that function for good. Writing `this.submit`\n" +
      "afterwards changes nothing the hook can see.\n\n" +
      'Keep the method, and keep what changes in `@state`: `@state mode = "draft"`, and\n' +
      '`submit() { return this.mode === "draft" ? this.saveDraft() : this.send() }`.\n\n',
  },

  read(cls, { self, resolve }) {
    const methods = methodsOf([cls, ...heritage(cls, resolve)]);
    if (methods.size === 0) return [];

    const found: MethodWrittenOverIssue[] = [];
    for (const member of cls.members) {
      const writtenIn = ts.isConstructorDeclaration(member) ? "constructor" : (memberName(member) ?? "a member");
      (function walk(at: ts.Node): void {
        // A nested class has a `this` of its own.
        if (at !== member && (ts.isClassDeclaration(at) || ts.isClassExpression(at))) return;
        const target =
          ts.isBinaryExpression(at) &&
          at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
            ? at.left
            : undefined;
        if (
          target !== undefined &&
          ts.isPropertyAccessExpression(target) &&
          target.expression.kind === ts.SyntaxKind.ThisKeyword &&
          ts.isIdentifier(target.name) &&
          methods.has(target.name.text)
        ) {
          found.push({ component: self.name, method: target.name.text, writtenIn, ...positionOf(target) });
        }
        ts.forEachChild(at, walk);
      })(member);
    }
    return found;
  },
} as const satisfies Rule<MethodWrittenOverIssue>;
