import ts from "typescript";
import { positionOf } from "../syntax";
import type { Rule } from "./rule";

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

/** The lifecycle decorator on a member, when it carries one. */
function lifecycleOf(member: ts.ClassElement): string | undefined {
  // `getDecorators`, NOT `getModifiers`. They are separate lists in the modern API, and asking the
  // second for a decorator answers nothing at all — which made the first version of this rule
  // silent on every input, including the fault planted to prove it worked.
  for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
    const expression = decorator.expression;
    // `@mounted` and `@mounted({ env: "client" })` are both this.
    const name = ts.isCallExpression(expression) ? expression.expression : expression;
    if (ts.isIdentifier(name) && LIFECYCLES.has(name.text)) return name.text;
  }
  return undefined;
}

/** Whether anything in the body could catch a rejection — a `try` or an explicit `.catch()`. */
function guarded(body: ts.Node): boolean {
  let found = false;
  (function look(node: ts.Node): void {
    if (found) return;
    if (ts.isTryStatement(node)) {
      found = true;
      return;
    }
    // `await this.load().catch(…)` and `void this.load().catch(…)` handle it themselves.
    if (ts.isPropertyAccessExpression(node) && node.name.text === "catch") {
      found = true;
      return;
    }
    ts.forEachChild(node, look);
  })(body);
  return found;
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
    severity: "warn",
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
      "lifecycle runner catches that. Any `try` or `.catch` in the body is taken as handling it.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self }) {
    const found: UnguardedAsyncLifecycleIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member) || member.body === undefined) continue;
      const isAsync = (ts.getModifiers(member) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!isAsync) continue;

      const phase = lifecycleOf(member);
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
