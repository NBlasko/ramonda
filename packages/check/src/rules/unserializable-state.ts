import ts from "typescript";
import { positionOf } from "../syntax";
import { lossyIn } from "./lossyValue";
import { hasDecorator } from "./render-reach";
import type { Rule } from "./rule";

/**
 * `@state` holding something the hydration blob cannot carry.
 *
 * The server's state travels to the client as JSON. A `Map`, a `Set`, a `Date`, a `RegExp`, a class
 * instance or a function is not carried — and none of them THROWS on the way, which is what makes
 * this quiet: `JSON.stringify(new Map())` is `{}`, and a `Date` arrives as a string. The client
 * starts with a value of the wrong shape and the page fails later, somewhere else, on a method the
 * value no longer has.
 *
 * ## Why this is gated and `persist-of-a-lossy-value` is not
 *
 * The two are the same question about the same blob, and they differ in exactly one thing.
 * `@persist` creates no signal and has no other purpose — a field marked with it and never
 * serialized has no behaviour at all, so the decorator itself is the claim and the fault exists in
 * any project. `@state` is reactive state, and in a project that never renders on a server there is
 * no blob for it to cross: a `Map` in state is then perfectly correct and reporting it would be
 * reporting a working application.
 *
 * So this rule declares {@link Rule.needsServerRendering}, and a browser-only project does not skip
 * it — it is not asked. The gate is read from imports, once, the same way `needs` is: core's
 * `renderToString`, `renderPage` or `renderStatic`, or `hydrateRoot`, which is the client half of
 * the same story.
 *
 * ## What it reads
 *
 * The initializer, through object and array literals, because `{ createdAt: new Date() }` is the
 * commonest shape of this by a distance. Written once in `lossyValue.ts` and shared with
 * `persist-of-a-lossy-value`, so the two can never disagree about what JSON carries.
 *
 * `RMD033` is the runtime half of both. It reads the VALUE at serialization time, so it sees what an
 * initializer cannot — and it only speaks for a render that happened.
 */
export interface UnserializableStateIssue {
  /** The component or hook. */
  component: string;
  /** The state field, as a reader would find it. */
  field: string;
  /** What it holds — `Map`, `Date`, `a function`. */
  holds: string;
  /** What JSON does with it, which is the sentence the report needs. */
  becomes: string;
  file: string;
  line: number;
  column: number;
}

export const unserializableState = {
  id: "unserializable-state",
  needsServerRendering: true,

  report: {
    severity: "warn",
    reportedWhen:
      "a `@state` field holds a `Map`, a `Set`, a `Date`, a function or a class instance, and the project renders on a server",
    alsoReportedAs: ["RMD019", "RMD033"],
    heading: (found) => `${found.length} \`@state\` field(s) the hydration blob cannot carry:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> holds ${issue.holds} in \`${issue.field}\` — it arrives as ${issue.becomes}.`,
    ],
    advice:
      "The server's state travels to the client as JSON, and none of these survives the trip. It\n" +
      "fails quietly, too: nothing throws on the way out, so a `Map` becomes `{}` and a `Date`\n" +
      "becomes a string, and the page fails later, somewhere else, on a method the value no longer\n" +
      "has.\n\n" +
      "Keep a form of it that survives — an id, an ISO string, an array of entries — and rebuild the\n" +
      "object where it is used, or in a `@compute` beside it. Where the value is only ever wanted in\n" +
      "the browser, build it in `@created`, which hydration skips, and leave it out of state.\n\n" +
      "This is only asked of a project that renders on a server. With no blob to cross, a `Map` in\n" +
      "state is correct and nothing here has an opinion about it.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self }) {
    const found: UnserializableStateIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;
      if (!hasDecorator(member, "state")) continue;
      /**
       * A field that is BOTH is `persist-of-a-lossy-value`'s, which asks without a gate.
       *
       * Two reports on one line is how a reader learns to skim past both, and the ungated one is
       * the better answer here: `@persist` says the field is meant to travel, whatever the project
       * does about servers.
       */
      if (hasDecorator(member, "persist")) continue;

      if (member.initializer === undefined) continue;
      const lossy = lossyIn(member.initializer);
      if (lossy === undefined) continue;

      found.push({ component: self.name, field: member.name.text, ...lossy, ...positionOf(member) });
    }

    return found;
  },
} as const satisfies Rule<UnserializableStateIssue>;
