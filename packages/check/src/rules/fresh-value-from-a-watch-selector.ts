import ts from "typescript";
import { coreDecoratorName } from "./core-import";
import { positionOf } from "../syntax";
import { freshnessOf, returnedBy, shorten } from "./follow-value";
import type { Rule } from "./rule";

/**
 * A `@watchProp` selector that BUILDS the value it hands back.
 *
 * The framework compares a selector's value with `Object.is`, so an object or an array built inside
 * the selector is never equal to the one before it — and the watcher fires on every props change,
 * with `previous` and `next` holding the same contents.
 *
 * ## Measured, not reasoned about
 *
 * Two watchers on one child, under a parent whose UNRELATED prop moves three times, counting how
 * often each fired:
 *
 * | the selector | fired |
 * |---|---|
 * | `(p) => p.q` | **0** |
 * | `(p) => ({ q: p.q })` | **3** |
 *
 * `q` never changed once.
 *
 * ## Why this is an error where the props rule is a warning
 *
 * `fresh-object-in-props` costs work and the page is right either way. This is not that: a
 * `@watchProp` body is where an app refetches, resets a form, cancels a request. Firing it when
 * nothing changed is not slow, it is wrong — and there is no reading of a built selector value that
 * is intentional, because `Object.is` can only answer "different" to it. A selector that always
 * says "changed" is a selector that does nothing, and the same is true of `arrow-fields`, which is
 * an error for the same sentence.
 *
 * ## What is NOT this
 *
 * **A selector that READS an object** — `(p) => p.filter` — hands back whatever the parent gave and
 * is not building anything. If the parent rebuilds it, that is `fresh-object-in-props` at the call
 * site, which is where the fix belongs.
 *
 * **A subscription's arguments.** `@onStore({ topic: "x" })` looks like the same shape and is not:
 * a decorator's arguments are evaluated once, when the class is defined. Measured — two instances
 * and three renders share ONE object — so there is nothing to report and this never asks.
 */
export interface FreshValueFromAWatchSelectorIssue {
  /** The class the watcher is on. */
  component: string;
  /** The method that fires, which is what the reader has to look at. */
  method: string;
  /** Which selector, when there is more than one — 1-based, as a reader counts them. */
  selector: number;
  /** How many there are, so the report can stay quiet about position when there is only one. */
  selectors: number;
  kind: "object" | "array";
  /** What it hands back, as written. */
  written: string;
  file: string;
  line: number;
  column: number;
}

export const freshValueFromAWatchSelector = {
  id: "fresh-value-from-a-watch-selector",

  report: {
    severity: "error",
    reportedWhen:
      "a `@watchProp` selector builds the value it returns — an object or an array — so `Object.is` can never match it and the watcher fires on every props change with nothing changed",
    heading: (found) => `${found.length} watcher(s) that fire on every props change:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    ${issue.selectors > 1 ? `Selector ${issue.selector} on` : "The selector on"} \`${
        issue.component
      }.${issue.method}\` returns \`${issue.written}\`, a new ${
        issue.kind
      } every time it runs — so \`${issue.method}\` fires on every props change, with \`previous\` and \`next\` holding the same contents.`,
    ],
    advice:
      "A selector's value is compared with `Object.is`, so a value BUILT inside the selector is\n" +
      "never equal to the one before it. Measured: a watcher whose selector returns `p.q` fired\n" +
      "zero times over three unrelated props changes, and one returning `{ q: p.q }` fired three.\n\n" +
      "This is an error rather than a warning because a `@watchProp` body is where an app refetches,\n" +
      "resets a form, cancels a request — firing it when nothing changed is wrong, not slow. And\n" +
      "there is no version of it that was intended: a selector that always says CHANGED is a\n" +
      "selector that does nothing.\n\n" +
      "Write one selector per value. They are handed over as a tuple, in the order you wrote them,\n" +
      "and `previous[i] === next[i]` tells you which one moved:\n\n" +
      "    @watchProp((p) => p.page, (p) => p.term)\n" +
      "    reload(next: [number, string], previous: [number, string]) { … }\n\n" +
      "A selector that READS an object rather than building one — `(p) => p.filter` — is fine here.\n" +
      "If that prop is rebuilt by the parent, `fresh-object-in-props` reports it at the call site,\n" +
      "which is where the fix belongs.",
  },

  read(cls, { self, resolve }) {
    const found: FreshValueFromAWatchSelectorIssue[] = [];

    for (const member of cls.members) {
      if (member.name === undefined || !ts.isIdentifier(member.name)) continue;

      for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
        if (coreDecoratorName(decorator, resolve) !== "watchProp") continue;

        for (const [index, argument] of call.arguments.entries()) {
          if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) continue;

          const returned = returnedBy(argument);
          if (returned === undefined) continue;

          const built = freshnessOf(returned, resolve, 0);
          if (built === undefined) continue;

          found.push({
            component: self.name,
            method: member.name.text,
            selector: index + 1,
            selectors: call.arguments.length,
            kind: built.kind,
            written: shorten(returned),
            ...positionOf(argument),
          });
        }
      }
    }

    return found;
  },
} as const satisfies Rule<FreshValueFromAWatchSelectorIssue>;
