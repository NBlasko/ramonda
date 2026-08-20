import ts from "typescript";
import { isThisUse, memberName, positionOf } from "../syntax";
import { hasDecorator } from "./render-reach";
// The field judgement itself, shared with `row-reads-a-plain-field`: which fields a CACHED reader
// can go stale on, and which writes count. See `stale-field.ts` for why it is not written twice.
import { staleFieldsOf } from "./stale-field";
import type { Rule } from "./rule";

/**
 * A CACHED reader — a `@compute` or a hook's props callback — reading an ordinary field that
 * something writes after the first render.
 *
 * ## What actually happens, measured rather than reasoned about
 *
 * A `@compute` caches, and it recomputes when one of the things it TRACKS changes — state and
 * props. An ordinary field is neither, so writing it invalidates nothing. What that costs was
 * measured by running it: a component with `@state tick`, a plain `rate`, and
 * `@compute get total() { return this.tick * this.rate }`.
 *
 * | step | on screen | truth |
 * |---|---|---|
 * | `rate = 10`, no render | `0` | `0` — correct, nothing has changed on screen |
 * | `tick = 1` → renders | `10` | `10` — correct, a tracked dependency moved |
 * | `rate = 100`, then an UNRELATED state change renders | **`10`** | `100` |
 *
 * The last row is the fault, and it is the bad kind: the page re-rendered, everything else on it
 * updated, and this one number is wrong. Nothing throws, nothing is reported at runtime, and the
 * value is wrong rather than missing — somebody reads a total that is not the total.
 *
 * ## Two readers, one fault
 *
 * A `@compute` caches on the state and props it reads. A hook's props callback caches the same way —
 * `this.use(Form, () => ({ schema: this.schema }))` is not called again on a render where none of
 * the signals it read moved. Neither notices an ordinary field, so both hold an answer built from a
 * value that has since changed.
 *
 * They were nearly two rules. They are one because the fault is one: the same set of fields, the
 * same writes, the same fix. Two rules would have been two copies of every judgement below, and
 * this session has spent enough time on pairs that drifted.
 *
 * The runtime reports the props-callback half as `RMD027`, and names the same root cause in its own
 * words: "most often a plain field standing in for state". The `@compute` half has no code of its
 * own — it fails by holding a stale value rather than by being noticed.
 *
 * ## What is deliberately NOT reported, and why each one would be a false report
 *
 * **A field nothing writes after the first render.** A constant a compute reads —
 * `prefix = "Total: "` — can never be stale, and it is the commonest plain field there is. So a
 * WRITE is required, and writes in the constructor, in a field initializer and in `@created` do not
 * count: all three run before the first render, so the first computed value already has the final
 * one.
 *
 * **A write from inside a render or a `@compute`** — the memo pattern,
 * `if (!this.cache) this.cache = expensive()`. Advising `@state` there would be advising a loop.
 * `state-written-while-rendering` is the rule with an opinion about that shape.
 *
 * **`@destroyed`**, which runs after the last render.
 *
 * **A field holding a hook** (`x = this.use(Thing)`) or a function, both of which are read in a
 * compute all the time and are neither state nor stale. Functions are `arrow-fields`' subject.
 *
 * **A field read only by `render()`.** `render()` re-reads on every pass, so it is never stale.
 * The cache is what makes this a fault, so the rule is about `@compute` and nothing else.
 */
export interface CachedReadOfAPlainFieldIssue {
  /** The component or hook. */
  component: string;
  /** Which kind of cached reader it is, because they read differently in a report. */
  reader: "a `@compute`" | "a props callback";
  /** The member that will hold a stale value — the compute, or the field the `this.use` is on. */
  named: string;
  /** The ordinary field it reads. */
  field: string;
  /** The member that writes the field, which is what makes it stale. */
  writtenBy: string;
  file: string;
  line: number;
  column: number;
}

/** A member's name when it has a plain one. */
/** Every `this.X` read anywhere under a node. */
function fieldsReadIn(node: ts.Node): Set<string> {
  const found = new Set<string>();

  const walk = (at: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(at) &&
      at.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(at.name)
    ) {
      // A CALL through `this` is a method, not a field read: `this.format(x)`.
      const isCallee = ts.isCallExpression(at.parent) && at.parent.expression === at;
      if (!isCallee) found.add(at.name.text);
    }
    ts.forEachChild(at, walk);
  };

  walk(node);
  return found;
}

export const cachedReadOfAPlainField = {
  id: "cached-read-of-a-plain-field",

  report: {
    severity: "warn",
    reportedWhen:
      "a `@compute` or a hook's props callback reads an ordinary field that is written after the first render, so the cached value goes stale",
    alsoReportedAs: ["RMD027"],
    heading: (found) => `${found.length} cached read(s) that can hold a stale value:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.named}\` — ${issue.reader} — reads \`${issue.field}\`, ` +
        `which is not state: \`${issue.writtenBy}\` writes it, and that invalidates nothing.`,
    ],
    advice:
      "A `@compute` caches, and it recomputes when something it TRACKS changes — state and props. A\n" +
      "hook's props callback caches the same way. An ordinary field is neither, so writing one\n" +
      "invalidates nothing and the cached value stays.\n\n" +
      "The failure is worth picturing, because it is not a missing update. The page renders again\n" +
      "for some other reason, everything else on it is correct, and this one value is the answer\n" +
      "from before the field changed. Nothing throws and nothing is reported — the number is simply\n" +
      "wrong.\n\n" +
      "Mark the field `@state`. That is what it is: data the render depends on and something\n" +
      "changes. Nothing else about the component has to move.\n\n" +
      "A field nothing writes after the first render is NOT reported — a constant a compute reads\n" +
      "can never go stale, and neither can one written in the constructor or `@created`.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self }) {
    /** field → the member that writes it after the first render. Empty means nothing can be stale. */
    const writtenBy = staleFieldsOf(cls);
    if (writtenBy.size === 0) return [];

    const found: CachedReadOfAPlainFieldIssue[] = [];

    /** One reported read, whichever kind of cached reader found it. */
    const report = (node: ts.Node, reader: CachedReadOfAPlainFieldIssue["reader"], named: string): void => {
      for (const field of fieldsReadIn(node)) {
        const writer = writtenBy.get(field);
        if (writer === undefined) continue;
        found.push({ component: self.name, reader, named, field, writtenBy: writer, ...positionOf(node) });
      }
    };

    for (const member of cls.members) {
      if (hasDecorator(member, "compute")) {
        const named = memberName(member);
        if (named !== undefined) report(member, "a `@compute`", named);
        continue;
      }

      /**
       * `x = this.use(Hook, () => ({ … }))` — the SECOND argument, which is the props callback.
       *
       * Only a function written there is walked. `this.use(Hook, someFactory)` hands over a value
       * this cannot follow without dataflow, and a plain object rather than a callback is a
       * different fault with its own report (`RMD055`, which the types refuse anyway).
       */
      if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;
      const call = member.initializer;
      if (!ts.isCallExpression(call) || !isThisUse(call)) continue;

      const factory = call.arguments[1];
      if (factory === undefined) continue;
      if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) continue;

      const named = memberName(member);
      if (named !== undefined) report(factory, "a props callback", named);
    }

    return found;
  },
} as const satisfies Rule<CachedReadOfAPlainFieldIssue>;
