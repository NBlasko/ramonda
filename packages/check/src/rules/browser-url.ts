import ts from "typescript";
import { positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * A component or hook asking the BROWSER where it is, in a project whose router already knows.
 *
 * `window.location.pathname` and the router's `pathname` are the same fact from two sources, and
 * only one of them is reactive: read from the router, a component re-renders when the route moves;
 * read from `window`, it is a snapshot taken once and never corrected. The bug that follows is
 * quiet — the page is simply out of date — and it is what makes this worth reporting rather than
 * leaving to taste.
 *
 * The router also answers questions the URL does not: `#tab=film` is route state and
 * `#a-section` names an element, a distinction `location.hash` hands over as one string to be
 * sniffed.
 */
export interface BrowserUrlIssue {
  /** The class that reads it. */
  component: string;
  /** What was written — `window.location.pathname`, `location.hash`. */
  read: string;
  /** The member of the router that answers the same question, when one obviously does. */
  instead?: string;
  file: string;
  line: number;
  column: number;
}

/** The reads the router answers by name, for advice that names the replacement. */
const ROUTER_ANSWER: Record<string, string> = {
  pathname: "pathname",
  search: "searchParams",
  hash: "hashTags",
};

/**
 * A component or hook reading the browser's URL, where the router already holds it.
 *
 * **Only in a project that HAS a router** — `needs` below, which the registry applies. Without one,
 * `location` is the only place the answer lives and reporting it would be reporting the only thing
 * a reader could have written. The router's own package is left alone for the same reason from the
 * other side — `exempt` — because it is where the reading has to happen, and `urlUtils.ts` is the
 * file that does it.
 *
 * Reported as a WARNING and not a build failure, which is this repository's rule for a new rule:
 * one version that says so, the next that refuses. Nothing in this repository trips it today —
 * measured — so the first version costs nobody a red build while it is being tried.
 */
export const browserUrl = {
  id: "browser-url",
  needs: "@ramonda/router",
  exempt: "@ramonda/router/",

  report: {
    severity: "warn",
    // Components, not reads — four reads in one class is one component with a habit, and saying
    // "4 component(s)" of a file that has one is a count nobody can reconcile with what follows.
    heading: (found) => {
      const guilty = new Set(found.map((read) => read.component)).size;
      return (
        `${guilty} component(s) reading the browser's URL, not the router's` +
        `${found.length === guilty ? "" : ` — ${found.length} reads`}:`
      );
    },
    lines: (read) => [
      `  ${read.file}:${read.line}:${read.column}`,
      `    <${read.component}> reads \`${read.read}\`` +
        (read.instead ? ` — the router answers this with \`${read.instead}\`.` : "."),
    ],
    advice:
      "The two are the same fact from two sources, and only one of them is reactive: read from the\n" +
      "router, a component re-renders when the route moves; read from `window`, it is a snapshot\n" +
      "taken once and never corrected, so the page quietly goes out of date. The router also keeps a\n" +
      "distinction the URL hands over as one string — `#tab=film` is route state, `#a-section` names\n" +
      "an element — so a hash tag with no value is a section and one with a value is not.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const found: BrowserUrlIssue[] = [];

    ts.forEachChild(cls, function look(node) {
      if (ts.isPropertyAccessExpression(node)) {
        const member = node.name.text;
        const base = node.expression;
        /**
         * `window.location.x`, `globalThis.location.x`, `document.location.x` and a bare
         * `location.x`.
         *
         * A bare name counts only when it resolves to NOTHING. The program is built with
         * `noLib` and no `@types`, so the browser's own `location` has no declaration to find —
         * while `const location = …` written in the source does. That is what tells the global
         * from a local of the same name, and it costs no type.
         */
        const onLocation =
          (ts.isPropertyAccessExpression(base) &&
            base.name.text === "location" &&
            ts.isIdentifier(base.expression) &&
            ["window", "globalThis", "document"].includes(base.expression.text)) ||
          (ts.isIdentifier(base) && base.text === "location" && resolve(base) === undefined);

        /**
         * A READ, and only a read. Reported without this guard: `window.location.href = "…"`,
         * `location.assign("/x")` and `location.reload()` — measured, all three came out as
         * "reads", and a reload is the one thing the router cannot replace. A write is a different
         * fault with a different answer, and this rule is about asking the wrong source a question
         * the router already answers.
         */
        const written =
          ts.isBinaryExpression(node.parent) &&
          node.parent.left === node &&
          node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        const called = ts.isCallExpression(node.parent) && node.parent.expression === node;

        if (onLocation && !written && !called) {
          found.push({
            component: self.name,
            read: node.getText(),
            ...(ROUTER_ANSWER[member] ? { instead: ROUTER_ANSWER[member] } : {}),
            ...positionOf(node),
          });
        }
      }
      ts.forEachChild(node, look);
    });

    return found;
  },
} as const satisfies Rule<BrowserUrlIssue>;
