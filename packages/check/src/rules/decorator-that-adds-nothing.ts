import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * Two decorators on one member giving it the same thing, so one of them does nothing.
 *
 * `@state` already puts a field in the hydration blob, so a `@persist` beside it adds nothing at
 * all — the field was already serialized, and the second line reads as though it were doing
 * something. The same for a decorator written twice.
 *
 * It is a small fault and it is worth reporting for a specific reason: the line that does nothing
 * is indistinguishable from the line that does the work, so it survives every reading of the file
 * and gets copied into the next component.
 *
 * ## Faithful to `claimMember`, which is where the runtime decides this
 *
 * `debug/claimMember.ts` records that a decorator gave a member a CAPABILITY, and reports `RMD050`
 * when something already had it. This mirrors that table rather than inventing one — the pairs it
 * reports are exactly the pairs the runtime reports, and the ones it stays quiet about are the ones
 * the runtime lets through.
 *
 * ## The same decorator TWICE is not this rule's — it is `duplicate-decorators`'
 *
 * Found by building this one and watching both fire on the same line. That rule is named for
 * class-level single-use decorators and covers member-level repeats as well, so `@state @state`
 * already had an answer. This one reports only what it did not: two DIFFERENT decorators giving one
 * member the same thing. Both answer `RMD050`, which is a genuine pair rather than a collision —
 * the runtime raises one code for what are, from the reader's side, two different mistakes.
 *
 * ## What is deliberately NOT reported, and why it is most of them
 *
 * Two decorators doing DIFFERENT work on one member. `@created` with `@mounted`, `@onWindow` with
 * `@onDocument`, `@watchProp` with `@updated` — each of those runs twice on purpose, and the
 * runtime is silent about all of them. A rule that reported "two decorators on one member" would
 * report the idiom rather than the fault.
 */
export interface DecoratorThatAddsNothingIssue {
  /** The component or hook. */
  component: string;
  /** The member both decorators are on. */
  member: string;
  /** The decorator that adds nothing, which is the one to delete. */
  adds: string;
  /** What already gave the member that capability. */
  already: string;
  /** The capability itself, in the words the report prints. */
  capability: string;
  file: string;
  line: number;
  column: number;
}

/**
 * What each decorator gives a member — mirrors the `claimMember` calls in `base/decorators.ts`.
 *
 * `@state` claims two, which is the whole reason `@persist` beside it is redundant: reactivity is
 * its own, and serialization is the one they share.
 */
const GIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ["state", ["reactivity", "a place in the hydration blob"]],
  ["persist", ["a place in the hydration blob"]],
  ["memoizedHandler", ["a memoised handler"]],
  ["compute", ["a computed value"]],
]);

/** Every decorator written on a member, in source order, by name. */
function decoratorsOn(member: ts.ClassElement): { name: string; node: ts.Decorator }[] {
  const found: { name: string; node: ts.Decorator }[] = [];
  for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    if (ts.isIdentifier(expression)) found.push({ name: expression.text, node: decorator });
  }
  return found;
}

export const decoratorThatAddsNothing = {
  id: "decorator-that-adds-nothing",

  report: {
    severity: "warn",
    reportedWhen:
      "two decorators on one member give it the same thing — `@persist` beside `@state`, or one written twice",
    alsoReportedAs: ["RMD050"],
    heading: (found) => `${found.length} decorator(s) that add nothing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.member}\` has \`@${issue.adds}\`, but \`@${issue.already}\` ` +
        `already gives it ${issue.capability}.`,
    ],
    advice:
      "One of the two lines does nothing, and that is the whole problem with it: it looks exactly\n" +
      "like the line that does the work, so it survives every reading of the file and gets copied\n" +
      "into the next component.\n\n" +
      "`@state` already puts a field in the hydration blob, so `@persist` beside it adds nothing —\n" +
      "delete the `@persist`. Where the same decorator is written twice, delete one.\n\n" +
      "Two decorators doing DIFFERENT work on one member are not this: `@created` with `@mounted`,\n" +
      "`@onWindow` with `@onDocument`, `@watchProp` with `@updated` each run twice on purpose, and\n" +
      "neither this nor the framework says anything about them.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self }) {
    const found: DecoratorThatAddsNothingIssue[] = [];

    for (const member of cls.members) {
      // Skipped rather than reported: this names the MEMBER in its report, so one it cannot name is
      // one it cannot say anything useful about.
      const named = memberName(member);
      if (named === undefined) continue;

      /** capability → the decorator that claimed it first, which is the one that stays. */
      const claimed = new Map<string, string>();

      for (const { name, node } of decoratorsOn(member)) {
        for (const capability of GIVES.get(name) ?? []) {
          const already = claimed.get(capability);
          if (already === undefined) {
            claimed.set(capability, name);
            continue;
          }
          // The same decorator twice is `duplicate-decorators`' report, and it says more about it
          // than this could. Two rules on one line is how a reader learns to skim past both.
          if (already === name) continue;
          found.push({
            component: self.name,
            member: named,
            adds: name,
            already,
            capability,
            ...positionOf(node),
          });
          // One report per member, whichever capability collided first — the same cap `claimMember`
          // keeps, so a doubled `@state` says it once rather than once per capability it claims.
          break;
        }
      }
    }

    return found;
  },
} as const satisfies Rule<DecoratorThatAddsNothingIssue>;
