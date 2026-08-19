import ts from "typescript";
import { positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * `async render()` — a render that returns a promise instead of markup.
 *
 * ## Why a rule, when the type system already refuses it
 *
 * Because a type is only a defence while nobody casts it away, and this one is defeated by a single
 * comment. Measured, rather than argued:
 *
 * | written as | `tsc` |
 * |---|---|
 * | `async render()` | **TS2416** — refused |
 * | `render = async () => …` | **TS2416** — refused |
 * | `async render()` under a `@ts-ignore` | **compiles** |
 * | `async render()` on a base class loosened by one cast | **compiles** |
 *
 * Two of the four ship. And what ships is not a graceful failure: the diff is handed a promise
 * where a node belongs, and throws `TypeError: component is not a constructor` from inside
 * `DiffAndMerge` — a stack of framework frames naming neither the component nor `render`. Measured
 * too; that is the exact message.
 *
 * So the type is the first answer, this rule is the second, and `RMD060` is the third for the
 * build that has no types at all. Being refused by a compiler is a reason to check something
 * cheaply, not a reason to leave it unchecked.
 *
 * ## What makes it provable
 *
 * The `async` keyword on a member named `render`, which is syntax. No type is asked and none is
 * needed: there is no `async render()` that is correct, so there is nothing to be quiet about.
 */
export interface AsyncRenderIssue {
  /** The component or hook. */
  component: string;
  /** How it was written, because the two spellings read differently in a report. */
  written: "method" | "field";
  file: string;
  line: number;
  column: number;
}

/** Whether a member carries the `async` keyword. */
function isAsync(modifiers: ts.NodeArray<ts.ModifierLike> | undefined): boolean {
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;
}

export const asyncRender = {
  id: "async-render",

  report: {
    severity: "error",
    reportedWhen: "`render()` is `async`, so it returns a promise where the diff expects markup",
    alsoReportedAs: "RMD060",
    heading: (found) => `${found.length} component(s) whose \`render()\` is async:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> returns a promise from \`render()\` — nothing it builds is ever rendered.`,
    ],
    advice:
      "`render()` must return markup, not a promise for it. An `async` one returns a `Promise` the\n" +
      "moment it is called, so the diff is handed an object that is not a node and throws from\n" +
      "inside the framework — a `TypeError` naming neither your component nor `render`.\n\n" +
      "Load the data outside the render. `@mounted` (or `@created`) can await it and write the\n" +
      "result into `@state`, leaving `render()` to show whichever state the component is in. Where\n" +
      "the promise itself is the subject, `AsyncLoad` takes it and renders a fallback while it\n" +
      "settles.\n\n" +
      "The type system refuses this too, so reaching it means a `@ts-ignore`, a cast, or a base\n" +
      "class loosened somewhere above — which is exactly why it is worth checking here as well.",
  },

  read(cls, { self }) {
    const found: AsyncRenderIssue[] = [];

    for (const member of cls.members) {
      if (member.name === undefined || !ts.isIdentifier(member.name) || member.name.text !== "render") continue;

      if (ts.isMethodDeclaration(member) && isAsync(member.modifiers)) {
        found.push({ component: self.name, written: "method", ...positionOf(member) });
        continue;
      }

      // `render = async () => …`. A different spelling of the same fault, and the one `tsc` is
      // likelier to be talked out of, since a field's type is inferred from what it is given.
      if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
        const written = member.initializer;
        const isAsyncFunction =
          (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) && isAsync(written.modifiers);
        if (isAsyncFunction) found.push({ component: self.name, written: "field", ...positionOf(member) });
      }
    }

    return found;
  },
} as const satisfies Rule<AsyncRenderIssue>;
