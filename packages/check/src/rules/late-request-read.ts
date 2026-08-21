import ts from "typescript";
import { positionOf } from "../syntax";
import { importedFromCore } from "./core-import";
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
    reportedWhen: "`requestContext()` is read below an `await`, after the request it names is gone",
    alsoReportedAs: "RMD053",
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

  read(cls, { self, resolveLocal, resolveStep }) {
    const found: LateRequestReadIssue[] = [];

    /** `requestContext()` — the export `@ramonda/core` declares, not any function with that name. */
    const isRequestContextCall = (node: ts.Node): node is ts.CallExpression => {
      if (!ts.isCallExpression(node)) return false;
      const callee = node.expression;
      const id = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
      if (!id) return false;
      /**
       * The name the MODULE exports it under, not the one this file gave it.
       *
       * `import { requestContext as rc }` and an app's own `ui` module re-exporting it both rename
       * the binding, and testing the LOCAL name before asking about the module went quiet on both.
       * A namespace call — `core.requestContext()` — keeps its own name on the property, which is
       * what the second branch reads.
       */
      if (ts.isPropertyAccessExpression(callee)) {
        return id.text === "requestContext" && importedFromCore(callee.expression, resolveLocal, resolveStep);
      }
      return importedFromCore(id, resolveLocal, resolveStep, "requestContext");
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
          /**
           * The held door, opened any of the three ways it is written.
           *
           * `context.headers` was the only one read. A destructure and a bracket reach the same
           * getters on the same object — `const { headers } = context` runs `context.headers`
           * exactly as the dotted form does — and both were silent.
           */
          if (
            (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
            ts.isIdentifier(node.expression)
          ) {
            const symbol = resolveLocal(node.expression);
            if (symbol && held.has(symbol)) {
              report(node, "local");
              return;
            }
          }

          if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.initializer)) {
            const symbol = resolveLocal(node.initializer);
            if (symbol && held.has(symbol) && ts.isObjectBindingPattern(node.name)) {
              for (const element of node.name.elements) {
                const named = element.propertyName ?? element.name;
                if (!ts.isIdentifier(named)) continue;
                // Quoted as the reader sees it: `{ headers } = context`, not a dotted form that is
                // nowhere on the line.
                found.push({
                  component: self.name,
                  member,
                  read: `{ ${named.text} } = ${node.initializer.getText()}`,
                  via: "local",
                  ...positionOf(element),
                });
              }
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
