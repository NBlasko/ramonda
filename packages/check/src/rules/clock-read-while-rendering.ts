import ts from "typescript";
import { positionOf } from "../syntax";
import { walkRenders } from "./render-reach";
import type { Rule } from "./rule";

/**
 * A clock or a random number read by something a render reaches.
 *
 * A render has to be a function of state and props, and these two are neither. Read one and the
 * same inputs produce a different answer every pass, which breaks three things at once: the diff
 * sees a change that is not one and rebuilds, a `@compute` recomputes forever, and a
 * server-rendered page cannot be hydrated because the server's answer and the client's were taken a
 * few hundred milliseconds apart.
 *
 * **That last one is why this rule earns its place even though the framework already reports it.**
 * `RMD021` fires when it can see the read, but the symptom users actually meet is `RMD007` — a
 * hydration MISMATCH — and RMD007's advice sends a reader looking for non-determinism they have to
 * find themselves. This names it, in a branch nobody has rendered yet.
 *
 * `new Date(value)` is left alone. Parsing a timestamp is deterministic; it is the argument-less
 * `new Date()` that asks what time it is.
 */
export interface ClockReadWhileRenderingIssue {
  /** The component or hook. */
  component: string;
  /** What was read — `Date.now()`, `new Date()`, `Math.random()`, `performance.now()`. */
  read: string;
  /** How the render got there. */
  through: readonly string[];
  file: string;
  line: number;
  column: number;
}

/**
 * The reads that are not a function of state and props.
 *
 * Deliberately short. `Date` and `Math` and `performance` are the three the language offers, and a
 * rule that also guessed at `uuid()` or `nanoid()` would be guessing at names — which is how a
 * checker starts reporting a helper called `randomHexColour` that returns a constant.
 */
function nonDeterministic(node: ts.Node): string | undefined {
  // `new Date()` with no arguments. With one, it parses, and parsing is deterministic.
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date") {
    return node.arguments === undefined || node.arguments.length === 0 ? "new Date()" : undefined;
  }

  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const call = node.expression;
  if (!ts.isIdentifier(call.expression)) return undefined;

  const owner = call.expression.text;
  const member = call.name.text;

  if (owner === "Date" && member === "now") return "Date.now()";
  if (owner === "Math" && member === "random") return "Math.random()";
  if (owner === "performance" && member === "now") return "performance.now()";
  return undefined;
}

export const clockReadWhileRendering = {
  id: "clock-read-while-rendering",

  report: {
    severity: "warn",
    reportedWhen: "`Date.now()`, `new Date()` or `Math.random()` is reached from a render, by any path",
    alsoReportedAs: "RMD021",
    heading: (found) => `${found.length} clock or random read(s) reached from a render:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> reads \`${issue.read}\` — reached by ${issue.through.join(" → ")}.`,
    ],
    advice:
      "A render has to be a function of state and props, and neither of these is. The same inputs\n" +
      "then produce a different answer every pass: the diff sees a change that is not one, a\n" +
      "`@compute` recomputes forever, and a server-rendered page cannot be hydrated — the server's\n" +
      "answer and the client's were taken a few hundred milliseconds apart.\n\n" +
      "That last one is the reason to catch it here. What a reader actually meets is a hydration\n" +
      "mismatch, whose advice is to go and find the non-determinism; this names it instead.\n\n" +
      "Decide the value once and keep it: read the clock in `@created` and hold it in `@state`, and\n" +
      "mark it `@persist` so the client restores the server's value rather than taking a new one.\n\n" +
      "`new Date(value)` is not reported — parsing a timestamp is deterministic. It is the\n" +
      "argument-less `new Date()` that asks what time it is.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const found: ClockReadWhileRenderingIssue[] = [];

    walkRenders(cls, {
      resolve,
      visit(node, through) {
        const read = nonDeterministic(node);
        if (read === undefined) return;
        found.push({ component: self.name, read, through: [...through], ...positionOf(node) });
      },
    });

    return found;
  },
} as const satisfies Rule<ClockReadWhileRenderingIssue>;
