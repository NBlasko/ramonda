import ts from "typescript";
import { positionOf } from "../syntax";
import { stateFieldsOf, walkRenders } from "./render-reach";
import type { Rule } from "./rule";

/**
 * State written by something a render reaches.
 *
 * `render()` and `@compute` answer a question: given this state and these props, what does the
 * component look like. Writing state while answering it makes the answer depend on how many times
 * it was asked — and the framework asks whenever it likes. The result is a render that schedules a
 * render, which either loops or settles on whichever value the last pass happened to leave.
 *
 * The framework reports it at runtime as `RMD001` (and `RMD018` inside a `@compute`), which is the
 * better report when it fires: it knows which field, on which instance, in which pass. What it
 * cannot do is fire for a branch nobody took.
 *
 * ## The reach is the rule
 *
 * A write is almost never in the body of `render()`. It is in a helper the render calls, or in a
 * formatter imported from another file, or in the third branch of a chain of conditionals. See
 * `render-reach.ts` for what is followed and what is deliberately not — above all, a function
 * written as a JSX attribute is a HANDLER and is never walked, because writing state there is the
 * correct thing to do.
 */
export interface StateWrittenWhileRenderingIssue {
  /** The component or hook. */
  component: string;
  /** The state field written. */
  field: string;
  /** How the render got there — `render → rowFor → stamp`. */
  through: readonly string[];
  file: string;
  line: number;
  column: number;
}

/** The assignment operators. `this.n += 1` and `this.n++` are writes as much as `=` is. */
function writtenBy(node: ts.Node): ts.PropertyAccessExpression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
    ts.isPropertyAccessExpression(node.left)
  ) {
    return node.left;
  }
  if (
    (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isPropertyAccessExpression(node.operand)
  ) {
    return node.operand;
  }
  return undefined;
}

export const stateWrittenWhileRendering = {
  id: "state-written-while-rendering",

  report: {
    severity: "warn",
    reportedWhen:
      "a state write is reached from `render()` or a `@compute` — directly, through a " +
      "helper it calls, or three files away",
    // `RMD018` is the same fault inside a `@compute`, which this walk reaches from as well.
    alsoReportedAs: ["RMD001", "RMD018"],
    heading: (found) => `${found.length} state write(s) reached from a render:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> writes \`${issue.field}\` — reached by ${issue.through.join(" → ")}.`,
    ],
    advice:
      "`render()` and `@compute` answer one question: given this state and these props, what does\n" +
      "the component look like. A write while answering it makes the answer depend on how many\n" +
      "times it was asked, and the framework asks whenever it likes — so a render schedules a\n" +
      "render, which either loops or settles on whatever the last pass happened to leave.\n\n" +
      "Move it to where the change belongs: an event handler, `@mounted`, `@updated`, or a\n" +
      "`@watchProp` if it follows a prop. If the value is derived from state you already have, it is\n" +
      "a `@compute` and does not need to be written at all.\n\n" +
      "A function written as a JSX attribute is NOT reported: `onclick={() => this.n++}` is a\n" +
      "handler, and that is exactly where writing state is right.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const fields = stateFieldsOf(cls, resolve);
    if (fields.size === 0) return [];

    const found: StateWrittenWhileRenderingIssue[] = [];

    walkRenders(cls, {
      resolve,
      visit(node, through, insideTheClass) {
        // Once the walk has followed a call out of the class, `this` is somebody else's.
        if (!insideTheClass) return;

        const target = writtenBy(node);
        if (target === undefined) return;
        if (target.expression.kind !== ts.SyntaxKind.ThisKeyword) return;
        if (!ts.isIdentifier(target.name) || !fields.has(target.name.text)) return;

        found.push({
          component: self.name,
          field: target.name.text,
          through: [...through],
          ...positionOf(node),
        });
      },
    });

    return found;
  },
} as const satisfies Rule<StateWrittenWhileRenderingIssue>;
