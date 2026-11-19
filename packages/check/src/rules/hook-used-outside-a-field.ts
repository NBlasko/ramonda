import ts from "typescript";
import { bindsThis, hookNamed, isStatic, isThisUse, memberName, positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * A `this.use(…)` written anywhere but as a field's whole initializer — `name = this.use(Hook, …)`.
 *
 * A hook is made while its owner is made, and at no other time: every `use()` runs once, in the same
 * order, for every instance. The runtime refuses a `use()` once the owner's construction is over
 * (RMD063), which covers a method, `@created`, `@mounted`, a handler and a callback. What it cannot see
 * is a `use()` that runs DURING construction but not always — behind a condition in a field or the
 * constructor, or once per pass of a loop. So the shape is closed here, to the one that has no such
 * reading: a field whose initializer is the call itself.
 *
 * The constructor body is refused too, even unconditionally: one shape is one answer, and a field
 * says everything a statement in the constructor can.
 */
export interface HookUsedOutsideAFieldIssue {
  /** The component or hook. */
  component: string;
  /** The hook, as written. */
  hook: string;
  /** The member the call is in. */
  usedIn: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Whether `call` is the whole initializer of an instance field: `name = this.use(…)`.
 *
 * Through what only the compiler reads — `as T`, `satisfies T`, `!`, `<T>` and parentheses — which
 * change no value and run nothing: `instance = this.use(hook as never, …) as T` is still the call,
 * once, for every instance.
 */
function isAFieldsWholeInitializer(call: ts.CallExpression): boolean {
  let at: ts.Node = call;
  while (
    ts.isParenthesizedExpression(at.parent) ||
    ts.isAsExpression(at.parent) ||
    ts.isSatisfiesExpression(at.parent) ||
    ts.isNonNullExpression(at.parent) ||
    ts.isTypeAssertionExpression(at.parent)
  ) {
    at = at.parent;
  }
  const parent = at.parent;
  return ts.isPropertyDeclaration(parent) && parent.initializer === at && !isStatic(parent);
}

export const hookUsedOutsideAField = {
  id: "hook-used-outside-a-field",

  report: {
    severity: "error",
    reportedWhen:
      "a component or hook calls `this.use()` anywhere but as a field's whole initializer — in a method, a lifecycle, the constructor, a callback, behind a condition or in a loop",
    alsoReportedAs: "RMD063",
    heading: (found) => `${found.length} hook(s) used outside a field:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.usedIn}\` uses ${issue.hook} — a hook is made in a field, \`name = this.use(${issue.hook}, …)\`.`,
    ],
    advice:
      "A hook is made while its owner is made, once, in the same order, for every instance: the update walk,\n" +
      "the hook tree hydration restores state into, and what this check proves about a class rest on that.\n" +
      "Write each hook as a field — `private timer = this.use(Timeout, () => ({ run: this.tick }))` — and\n" +
      "when it should do nothing at times, give it options that make it idle rather than leaving it out.\n" +
      "A `use()` after construction also throws when it runs (RMD063).\n\n",
  },

  read(cls, { self }) {
    const found: HookUsedOutsideAFieldIssue[] = [];
    for (const member of cls.members) {
      const usedIn = ts.isConstructorDeclaration(member)
        ? "constructor"
        : ts.isClassStaticBlockDeclaration(member)
          ? "static block"
          : (memberName(member) ?? "a member");
      (function walk(at: ts.Node): void {
        // Only an arrow keeps the instance's `this` — see `bindsThis`: a `function`'s `this` is its own,
        // and a class declared inside this one has its `use()` calls read when that class is.
        if (at !== member && bindsThis(at)) return;
        if (ts.isCallExpression(at) && isThisUse(at) && !isAFieldsWholeInitializer(at)) {
          const hook = at.arguments[0] === undefined ? "a hook" : hookNamed(at.arguments[0]).getText();
          found.push({ component: self.name, hook, usedIn, ...positionOf(at) });
        }
        ts.forEachChild(at, walk);
      })(member);
    }
    return found;
  },
} as const satisfies Rule<HookUsedOutsideAFieldIssue>;
