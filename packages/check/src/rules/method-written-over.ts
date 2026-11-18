import ts from "typescript";
import { bindsThis, isStatic, memberName, positionOf, targetsOf } from "../syntax";
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
 * Through a pattern (`[this.submit] = [this.send]`) and through `Object.assign(this, { submit })` too.
 * Writes from OUTSIDE the class — `row.submit = x` on an instance somewhere else — are not reachable
 * here: this package asks where names are declared, never what type a value has; nor is an
 * `Object.assign(this, source)` whose source is not written there.
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

/**
 * The instance methods a class has, its bases' included — by the NEAREST declaration of each name, which
 * is the one an instance has: a base's `submit()` that a subclass declares again as a field is a field.
 */
function methodsOf(declaring: readonly ts.ClassLikeDeclaration[]): Set<string> {
  const methods = new Set<string>();
  const seen = new Set<string>();
  for (const one of declaring) {
    for (const member of one.members) {
      if (isStatic(member) || ts.isClassStaticBlockDeclaration(member)) continue;
      const name = memberName(member);
      if (name === undefined || seen.has(name)) continue;
      if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) || ts.isAccessor(member)) seen.add(name);
      if (ts.isMethodDeclaration(member)) methods.add(name);
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
      // A static member's `this` is the class, not an instance.
      if (ts.isClassStaticBlockDeclaration(member) || isStatic(member)) continue;
      const writtenIn = ts.isConstructorDeclaration(member) ? "constructor" : (memberName(member) ?? "a member");
      (function walk(at: ts.Node): void {
        // Only an arrow keeps the instance's `this` — see `bindsThis`.
        if (at !== member && bindsThis(at)) return;
        // Every target an assignment writes, through any pattern: `[this.submit] = [this.send]` too.
        const targets: ts.Expression[] = [];
        if (
          ts.isBinaryExpression(at) &&
          at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          targetsOf(at.left, targets);
        }
        for (const target of targets) {
          if (
            ts.isPropertyAccessExpression(target) &&
            target.expression.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isIdentifier(target.name) &&
            methods.has(target.name.text)
          ) {
            found.push({ component: self.name, method: target.name.text, writtenIn, ...positionOf(target) });
          }
        }
        // `Object.assign(this, { submit: … })` writes each key of the object it is handed.
        if (
          ts.isCallExpression(at) &&
          ts.isPropertyAccessExpression(at.expression) &&
          at.expression.getText() === "Object.assign" &&
          at.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword
        ) {
          for (const source of at.arguments.slice(1)) {
            if (!ts.isObjectLiteralExpression(source)) continue;
            for (const property of source.properties) {
              const key =
                property.name !== undefined && ts.isIdentifier(property.name) ? property.name.text : undefined;
              if (key !== undefined && methods.has(key)) {
                found.push({ component: self.name, method: key, writtenIn, ...positionOf(property) });
              }
            }
          }
        }
        ts.forEachChild(at, walk);
      })(member);
    }
    return found;
  },
} as const satisfies Rule<MethodWrittenOverIssue>;
