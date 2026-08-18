import ts from "typescript";
import { positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * `requestContext()` read below an `await` — after the request it names is gone.
 *
 * The scope is one module-level value shared by every request the server is handling at once, and
 * `renderToString` clears it before its first `await`. That is what makes the shared value safe:
 * the synchronous section is atomic in Node, so no second request can be inside it. A read below a
 * yield therefore finds nothing, and the framework raises RMD053.
 *
 * **Why a static rule as well as the code.** The runtime report only fires on a path that RUNS —
 * an `@mounted` behind a condition nobody met ships with the fault — and, worse, the throw beside
 * it goes into the server's work drain and is swallowed, so the page is served complete and quietly
 * missing the value. This says it before anything runs. The two are not redundant and are not
 * symmetric: this sees only what it is pointed at and only a direct call or a same-scope local,
 * while RMD053 catches the read a variable carried out of this rule's reach.
 *
 * **What is deliberately NOT reported.** A read ABOVE the first `await` is correct and common —
 * an async `@created` may read the request and then go fetch. A nested callback is left alone
 * whatever encloses it: whether it runs before or after the yield is dataflow, which this analyzer
 * refuses by decision, and guessing would report the safe form.
 */
export interface LateRequestReadIssue {
  /** The class the read is in. */
  component: string;
  /** The method or field holding it. */
  member: string;
  /** What was written — `requestContext().get(currentUser)`, `context.headers`. */
  read: string;
  /** How the request was reached: called on the spot, or through a local taken earlier. */
  via: "call" | "local";
  file: string;
  line: number;
  column: number;
}

/**
 * The body of a class member that HOLDS code: a method, or a field initialised with a function.
 * `@created async init() {}` and `handler = async () => {}` are the two spellings, and this rule
 * has to judge both.
 */
function bodyOfMember(member: ts.ClassElement): ts.Node | undefined {
  if (ts.isMethodDeclaration(member) && member.body) return member.body;
  if (ts.isGetAccessorDeclaration(member) && member.body) return member.body;
  if (ts.isPropertyDeclaration(member) && member.initializer && isFunctionLike(member.initializer)) {
    const fn = member.initializer as ts.ArrowFunction | ts.FunctionExpression;
    return fn.body;
  }
  return undefined;
}

/** Anything that opens a new `await` timeline. */
function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * Whether an identifier was imported from `@ramonda/core`.
 *
 * By the written module SPECIFIER, not by where the declaration file sits on disk. Every project
 * here aliases `@ramonda/core` to `packages/core/src` so the analyzer reads sources rather than
 * `dist` — a path test would answer on the alias's target, which differs per project, while the
 * specifier is the same string the reader typed.
 *
 * Deliberately NOT a name match, unlike the `dom-writes` rule. Nobody writes `const document = …`
 * and reaches for `.body`, but an app having its own `requestContext` helper is entirely
 * plausible, and reporting inside it would be reporting the reader's own code for the framework's
 * rule.
 *
 * **This is what `resolveLocal` exists for.** The question is about the import STATEMENT, so the
 * symbol has to be the one written here, alias unfollowed — `resolve` would hand over the thing
 * the import points at, whose declaration is in core and says nothing about how this file reached
 * it. `import { requestContext as ctx }` and `import * as core from "@ramonda/core"` both arrive
 * here: the first through its `ImportSpecifier`, the second through the namespace identifier.
 */
function importedFromCore(id: ts.Node, resolveLocal: (node: ts.Node) => ts.Symbol | undefined): boolean {
  if (!ts.isIdentifier(id)) return false;
  const local = resolveLocal(id);
  return (local?.declarations ?? []).some((declaration) => {
    const clause =
      ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)
        ? declaration.parent.parent
        : ts.isImportClause(declaration)
          ? declaration
          : undefined;
    const statement = clause?.parent;
    if (!statement || !ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    const from = statement.moduleSpecifier.text;
    return from === "@ramonda/core" || from.startsWith("@ramonda/core/");
  });
}

/**
 * A `requestContext()` read below the first `await` of the function it is in.
 *
 * Reported as a WARNING, which is this repository's rule for a new rule: one version that says so,
 * the next that refuses.
 *
 * **Await state is per FUNCTION, and nested functions start clean.** An arrow inside a method is
 * not judged by what its enclosing body did: whether it runs before or after the yield is
 * dataflow. Reporting it would flag the correct form — `items.map((item) => …)` called
 * synchronously above the await — which is how a rule earns being switched off.
 */
export const lateRequestRead = {
  id: "late-request-read",

  report: {
    severity: "warn",
    // Components, not reads — the same count the sibling rules print, for the same reason: four
    // late reads in one class is one component with a habit.
    heading: (found) => {
      const guilty = new Set(found.map((read) => read.component)).size;
      return (
        `${guilty} component(s) reading the request after the render yielded` +
        `${found.length === guilty ? "" : ` — ${found.length} reads`}:`
      );
    },
    lines: (read) => [
      `  ${read.file}:${read.line}:${read.column}`,
      `    <${read.component}>.${read.member} reads \`${read.read}\`` +
        (read.via === "local" ? " through a context taken before the await." : " below an await."),
    ],
    advice:
      "The request is live only while the render is running. On the server that is the SYNCHRONOUS\n" +
      "section: the scope is installed, the tree is mounted, and it is cleared before the render's\n" +
      "first `await` — which is what makes ONE module-level value safe for a server rendering many\n" +
      "requests at once. A read below a yield finds nothing.\n\n" +
      "Read it in `render()`, in `@created`, or above the first `await` of an async lifecycle\n" +
      "method, and keep what you need in `@state` — that is what carries a value across the yield.\n" +
      "Holding the object does not: every member of it is a getter over the current request.\n\n" +
      "The framework reports the same read as RMD053 when the line actually runs. It cannot always\n" +
      "be heard — inside an async `@mounted` the throw beside it goes into the server's work drain\n" +
      "and is swallowed, and the page is served complete and quietly missing the value.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolveLocal }) {
    const found: LateRequestReadIssue[] = [];

    /** `requestContext()` — the export `@ramonda/core` declares, not any function with that name. */
    const isRequestContextCall = (node: ts.Node): node is ts.CallExpression => {
      if (!ts.isCallExpression(node)) return false;
      const callee = node.expression;
      const id = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
      if (!id || id.text !== "requestContext") return false;
      return importedFromCore(ts.isPropertyAccessExpression(callee) ? callee.expression : id, resolveLocal);
    };

    /**
     * One function body, in source order, carrying whether an `await` has been passed.
     *
     * Source order is what an `await` divides, so the walk is ordered rather than a
     * `forEachChild` sweep: `ts.forEachChild` visits a node's children in order, and the flag only
     * ever moves from false to true within one body.
     */
    const walk = (body: ts.Node, member: string): void => {
      // The locals this body took from `requestContext()` before yielding — `const ctx =
      // requestContext()` above the await, used below it. One hop and one scope: reading what a
      // local holds is not the general dataflow this analyzer refuses, it is the declaration
      // sitting in the same function.
      const held = new Set<ts.Symbol>();
      let yielded = false;

      const report = (node: ts.Node, via: "call" | "local"): void => {
        // The whole read, not the bare call: `requestContext().get(currentUser)` is what the reader
        // wrote and what they will search for.
        let outermost: ts.Node = node;
        while (
          ts.isPropertyAccessExpression(outermost.parent) ||
          (ts.isCallExpression(outermost.parent) && outermost.parent.expression === outermost)
        ) {
          outermost = outermost.parent;
        }
        found.push({
          component: self.name,
          member,
          read: outermost.getText(),
          via,
          ...positionOf(node),
        });
      };

      (function look(node: ts.Node): void {
        // A nested function is its own timeline — see the rule's docstring.
        if (node !== body && isFunctionLike(node)) return;

        if (ts.isAwaitExpression(node)) {
          ts.forEachChild(node, look);
          yielded = true;
          return;
        }
        // `for await (… of …)` yields on every step, and it is a ForOfStatement rather than an
        // AwaitExpression, so the check above never sees it.
        if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) yielded = true;

        // Only a local taken BEFORE the yield is worth following. Taken after one, the call itself
        // is the failure and is reported on its own line — following it as well would put a second
        // report on a line that never runs, and send the reader to the wrong one of the two.
        if (!yielded && ts.isVariableDeclaration(node) && node.initializer && isRequestContextCall(node.initializer)) {
          const symbol = ts.isIdentifier(node.name) ? resolveLocal(node.name) : undefined;
          if (symbol) held.add(symbol);
        }

        if (yielded) {
          if (ts.isCallExpression(node) && isRequestContextCall(node)) {
            report(node, "call");
            return;
          }
          if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
            const symbol = resolveLocal(node.expression);
            if (symbol && held.has(symbol)) {
              report(node, "local");
              return;
            }
          }
        }

        ts.forEachChild(node, look);
      })(body);
    };

    for (const member of cls.members) {
      const body = bodyOfMember(member);
      if (!body) continue;
      walk(body, member.name && ts.isIdentifier(member.name) ? member.name.text : "(anonymous)");
    }

    return found;
  },
} as const satisfies Rule<LateRequestReadIssue>;
