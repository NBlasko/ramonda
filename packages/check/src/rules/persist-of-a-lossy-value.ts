import ts from "typescript";
import { positionOf } from "../syntax";
import { hasDecorator } from "./render-reach";
import { lossyFieldValue } from "./lossyValue";
import type { Rule } from "./rule";

/**
 * `@persist` on a field holding something JSON cannot carry.
 *
 * `@persist` has exactly one job: put a field into the hydration blob so the client starts with what
 * the server had. The blob is JSON. So a `Map`, a `Set`, a `Date`, a `RegExp`, a class instance or a
 * function is not carried — and none of them THROWS on the way, which is what makes this quiet.
 * `JSON.stringify(new Map())` is `{}`, and a `Date` arrives as a string. The client then starts with
 * a value of the wrong shape and fails later, somewhere else, on a method the value no longer has.
 *
 * ## Why this needs no gate, where the same fault on `@state` would
 *
 * `@state` is reactive state and only reaches the blob on a server render, so a project that never
 * renders on the server may hold anything it likes in it. `@persist` creates no signal and does
 * nothing else: a field marked with it and never serialized has no behaviour at all. So the
 * decorator itself is the claim, and the value contradicting it is a fault in any project.
 *
 * It is the static half of `RMD033`, which says the same thing once the value actually crosses.
 * That diagnostic reads the VALUE at serialization time, so it sees what an initializer cannot —
 * and it only speaks for a render that happened. This one speaks for a page nobody has opened.
 *
 * ## What makes it provable
 *
 * The initializer, as written. `new Map()` is a `Map` whatever the type system thinks, and an arrow
 * function is a function. The type ANNOTATION is read the same way — as syntax, a name written in
 * the source, never as a question to the checker. A field with neither, or with an initializer this
 * cannot read, is left alone.
 */
export interface PersistOfALossyValueIssue {
  /** The component or hook. */
  component: string;
  /** The field, as a reader would find it. */
  field: string;
  /** What it holds — `Map`, `Date`, `a function`, `Intl.NumberFormat`. */
  holds: string;
  /** Where it is built, when that is not this line — a local, or the function that hands it back. */
  foundIn: string | undefined;
  /** What JSON does with it, which is the sentence the report needs. */
  becomes: string;
  file: string;
  line: number;
  column: number;
}

export const persistOfALossyValue = {
  id: "persist-of-a-lossy-value",

  report: {
    severity: "warn",
    reportedWhen:
      "a `@persist` field holds a `Map`, a `Set`, a `Date`, a function or a class instance, none of which JSON carries",
    alsoReportedAs: "RMD033",
    heading: (found) => `${found.length} \`@persist\` field(s) the hydration blob cannot carry:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> persists \`${issue.field}\`, which holds ${issue.holds}${
        issue.foundIn === undefined ? "" : `, built in ${issue.foundIn}`
      } — it arrives as ${issue.becomes}.`,
    ],
    advice:
      "`@persist` does one thing: it puts a field into the hydration blob, which is JSON. It creates\n" +
      "no signal and has no other effect, so a value JSON cannot carry makes the decorator do\n" +
      "nothing — quietly, because none of these throws on the way out. A `Map` becomes `{}` and a\n" +
      "`Date` becomes a string, and the page fails later, somewhere else, on a method the value no\n" +
      "longer has.\n\n" +
      "Persist a form of it that survives — an id, an ISO string, an array of entries — and rebuild\n" +
      "the object where it is used, or in a `@compute` beside it. Where the value is only ever\n" +
      "needed in the browser, build it in `@created`, which hydration skips, and do not persist it\n" +
      "at all.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const found: PersistOfALossyValueIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!hasDecorator(member, "persist", resolve)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const lossy = lossyFieldValue(member, resolve);
      if (lossy === undefined) continue;

      found.push({
        component: self.name,
        field: member.name.text,
        foundIn: undefined,
        ...lossy,
        ...positionOf(member),
      });
    }

    return found;
  },
} as const satisfies Rule<PersistOfALossyValueIssue>;
