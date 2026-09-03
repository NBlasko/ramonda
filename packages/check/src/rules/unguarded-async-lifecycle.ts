import ts from "typescript";
import { positionOf } from "../syntax";
import { coreDecorators } from "./lifecycle-env";
import type { Rule, RuleContext } from "./rule";

/**
 * An `async` lifecycle method with nothing to catch what it awaits.
 *
 * `@created`, `@mounted` and `@destroyed` are called and their promise is dropped. **An error
 * boundary never sees a rejection from one**, and that is deliberate: it arrives at an arbitrary
 * later moment, when the page is already interactive and there is no render left to fail, so
 * replacing the page with a fallback then is the worse outcome.
 *
 * What follows from that is the part worth reporting. The page renders as though the method
 * succeeded — the fetch that failed simply left its `@state` at the initial value — and the only
 * trace is an unhandled rejection in a console nobody is looking at. `RMD059` says so at runtime,
 * once the path has actually run; this says it before it ships, including for the failure nobody
 * has provoked yet.
 *
 * **The fix is not a bigger boundary, it is a `catch`.** The failure belongs in `@state`, where the
 * render can show it — which is also the only way to tell the reader anything at all.
 */
export interface UnguardedAsyncLifecycleIssue {
  /** The class holding it. */
  component: string;
  /** The method. */
  member: string;
  /** Which lifecycle it is — `created`, `mounted`, `destroyed`. */
  phase: string;
  file: string;
  line: number;
  column: number;
}

const LIFECYCLES = new Set(["created", "mounted", "destroyed"]);

/**
 * The lifecycle decorator on a member, when it carries one — by the name CORE exports it under.
 *
 * This compared a BARE NAME, which is this repository's standing lesson arriving late: measured on
 * a plant, `import { created as onCreate }` and `core.created()` both went quiet on the identical
 * fault, and an app's own function called `created` would have been judged as the framework's.
 *
 * `coreDecorators` is `lifecycle-env`'s, not a second copy. Two rules answering one question about
 * one decorator two different ways is exactly the drift a shared reader exists to prevent — and
 * that rule had already been through this.
 */
function lifecycleOf(member: ts.ClassElement, context: RuleContext): string | undefined {
  for (const { name } of coreDecorators(member, context)) if (LIFECYCLES.has(name)) return name;
  return undefined;
}

/** Whether anything in the body could catch a rejection — a `try` or an explicit `.catch()`. */
/**
 * Whether EVERY await in this body has something to catch it.
 *
 * This used to ask whether the body contained a `try` — any `try` — or a property called `catch`
 * anywhere in it. Measured on a plant, that silenced three real faults:
 *
 * - a `try` around something else entirely, with the fetch below it unguarded;
 * - `await a().catch(…)` followed by a second, bare `await`;
 * - `try { await … } finally { … }`, which catches nothing at all — a `finally` runs on the way
 *   past a rejection, it does not stop one.
 *
 * The question is about the AWAITS, so it is now asked of each of them: an await is handled when it
 * sits inside a `try` that has a `catch`, or when the thing it awaits ends in `.catch(…)`. One
 * unhandled await is the report, because one is all it takes.
 */
function guarded(body: ts.Node): boolean {
  return unhandledAwaitIn(body) === false;
}

function unhandledAwaitIn(body: ts.Node): boolean {
  let unhandled = false;
  (function look(node: ts.Node): void {
    if (unhandled) return;
    // A nested function is its own timeline, and its rejection is its own business — the same line
    // `late-request-read` draws about the same boundary.
    if (node !== body && isFunctionLike(node)) return;

    const awaited = ts.isAwaitExpression(node)
      ? node.expression
      : ts.isForOfStatement(node) && node.awaitModifier !== undefined
        ? node.expression
        : undefined;

    if (awaited !== undefined && !handlesItself(awaited) && !insideACatchingTry(node, body)) {
      unhandled = true;
      return;
    }
    ts.forEachChild(node, look);
  })(body);
  return unhandled;
}

/** `fetchPosts().catch(…)` — the promise deals with its own rejection. */
function handlesItself(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return handlesItself(expression.expression);
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "catch";
}

/**
 * A `try` between here and the method body that has a CATCH.
 *
 * `finally` does not count and that is the point of asking: it runs on the way past a rejection
 * and does not stop one, so `try { await … } finally { spinner.stop() }` leaves the same unhandled
 * rejection the rule is about.
 */
function insideACatchingTry(node: ts.Node, body: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at !== undefined && at !== body.parent; at = at.parent) {
    // Only the TRY BLOCK is protected. An await in the `catch` or the `finally` of the same
    // statement is not caught by it — that is the whole point of where a handler sits.
    if (ts.isTryStatement(at) && at.catchClause !== undefined && isWithin(node, at.tryBlock)) return true;
  }
  return false;
}

/** The four spellings of a function body, which is the boundary of one timeline. */
function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isWithin(node: ts.Node, container: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) if (at === container) return true;
  return false;
}

/** Whether the body actually suspends — a method with no `await` cannot reject asynchronously. */
function awaits(body: ts.Node): boolean {
  let found = false;
  (function look(node: ts.Node): void {
    if (found) return;
    // A nested function's `await` belongs to that function, not to this one.
    if (node !== body && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return;
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined)) {
      found = true;
      return;
    }
    ts.forEachChild(node, look);
  })(body);
  return found;
}

/**
 * An async lifecycle whose rejection nothing will report to the reader.
 *
 * A WARNING, which is this repository's rule for a new rule.
 *
 * **Only when it actually awaits.** A method marked `async` that never suspends can only throw
 * synchronously, which the lifecycle runner does catch — so reporting it would be reporting
 * something that already works.
 *
 * **Any `try` counts, and so does any `.catch`.** Whether the `try` actually covers the awaits is a
 * question about control flow, and being wrong about it means reporting a method that handles its
 * own failure — the one kind of mistake this package treats as fatal. A rule that asks only
 * "is there anything here that could catch" is the honest one.
 */
export const unguardedAsyncLifecycle = {
  id: "unguarded-async-lifecycle",

  report: {
    severity: "error",
    reportedWhen: "an `async` lifecycle awaits something with no `try` or `.catch` to handle a failure",
    alsoReportedAs: "RMD059",
    heading: (found) => `${found.length} async lifecycle(s) whose failure nothing would report:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>.${issue.member} is an async @${issue.phase} with no \`try\` around what it awaits.`,
    ],
    advice:
      "An error boundary does not see a rejection from a lifecycle, and that is deliberate: it\n" +
      "arrives at an arbitrary later moment, when the page is already interactive and there is no\n" +
      "render left to fail. Replacing the page with a fallback then is the worse outcome.\n\n" +
      "What follows is why this is worth reporting. The page renders as though the method\n" +
      "succeeded — the fetch that failed just left its `@state` at the initial value — and the only\n" +
      "trace is an unhandled rejection in a console nobody is watching.\n\n" +
      "So catch it where it happens and put the failure in `@state`, which is the only way to tell\n" +
      "the reader anything:\n\n" +
      '    @state error = "";\n' +
      "    @mounted async load() {\n" +
      "      try { this.posts = await fetchPosts(); }\n" +
      "      catch (e) { this.error = String(e); }\n" +
      "    }\n\n" +
      "If the failure really should take the page down, re-throw it from `render()` — that IS a\n" +
      "render, and a boundary can see it.\n\n" +
      "A method that never awaits is not reported: it can only throw synchronously, and the\n" +
      "lifecycle runner catches that. Any `try` or `.catch` in the body is taken as handling it.\n\n",
  },

  read(cls, context) {
    const { self } = context;
    const found: UnguardedAsyncLifecycleIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member) || member.body === undefined) continue;
      const isAsync = (ts.getModifiers(member) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!isAsync) continue;

      const phase = lifecycleOf(member, context);
      if (phase === undefined) continue;
      if (!awaits(member.body)) continue;
      if (guarded(member.body)) continue;

      found.push({
        component: self.name,
        member: member.name && ts.isIdentifier(member.name) ? member.name.text : "(anonymous)",
        phase,
        ...positionOf(member),
      });
    }

    return found;
  },
} as const satisfies Rule<UnguardedAsyncLifecycleIssue>;
