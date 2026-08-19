import ts from "typescript";
import { positionOf } from "../syntax";
import { hasDecorator } from "./render-reach";
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
  /** What JSON does with it, which is the sentence the report needs. */
  becomes: string;
  file: string;
  line: number;
  column: number;
}

/**
 * What JSON leaves behind, per constructor — the sentence the report prints.
 *
 * Written out rather than lumped into "not serializable" because the four differ in how they fail,
 * and the difference is what tells somebody whether their page is already broken: an empty object
 * fails at the first method call, while a `Date` that became a string fails only where somebody
 * asks it the time.
 */
const BECOMES: ReadonlyMap<string, string> = new Map([
  ["Map", "an empty object — `{}`, with every entry gone"],
  ["Set", "an empty object — `{}`, with every member gone"],
  ["WeakMap", "an empty object — `{}`"],
  ["WeakSet", "an empty object — `{}`"],
  ["Date", "a string, which has no `getTime` and is not a `Date` on the other side"],
  ["RegExp", "an empty object — `{}`"],
  ["Error", "an empty object — the message and the stack are not JSON"],
  ["URL", "an empty object — `{}`"],
  ["URLSearchParams", "an empty object — `{}`"],
]);

/**
 * Constructors whose result IS JSON, so `new` alone is not evidence.
 *
 * Short on purpose. Every other `new` produces an object whose prototype JSON drops, which is the
 * whole fault — a class instance arrives as a plain bag of its own fields, with no methods.
 */
const STILL_JSON: ReadonlySet<string> = new Set(["Array", "Object", "String", "Number", "Boolean"]);

/** What a class instance becomes, said once. */
const A_PLAIN_BAG = "a plain object — its fields survive, its prototype and every method do not";

/** The name a `new` expression constructs, dotted names included: `Intl.NumberFormat`. */
function constructedName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = constructedName(expression.expression);
    return owner === undefined ? undefined : `${owner}.${expression.name.getText()}`;
  }
  return undefined;
}

/** What a field holds, when that can be read off the source; `undefined` when it cannot. */
function lossyValueOf(member: ts.PropertyDeclaration): { holds: string; becomes: string } | undefined {
  const written = member.initializer;

  if (written !== undefined) {
    if (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) {
      return { holds: "a function", becomes: "nothing at all — JSON drops a function without a word" };
    }
    if (ts.isNewExpression(written)) {
      const name = constructedName(written.expression);
      if (name === undefined || STILL_JSON.has(name)) return undefined;
      // Looked up by the WHOLE name as written, dots included. So `Intl.NumberFormat` misses the
      // table and is described as an instance, which is what it is; and a `Map` imported under
      // another name misses it too and gets the same, slightly less specific, true sentence.
      // Anything not named in the table is an instance, and JSON flattens all of them the same way.
      return { holds: name, becomes: BECOMES.get(name) ?? A_PLAIN_BAG };
    }
    // Anything else written out — a literal, a call, a name — is either fine or unreadable, and
    // both mean silence.
    return undefined;
  }

  /**
   * No initializer, so the ANNOTATION is the only thing written. Read as syntax: `Map<string, T>`
   * is the name `Map` in the source, which is a fact about the file rather than a question about a
   * type. A field with no annotation either says nothing and is left alone.
   */
  const annotation = member.type;
  if (annotation === undefined) return undefined;
  if (ts.isFunctionTypeNode(annotation)) {
    return { holds: "a function", becomes: "nothing at all — JSON drops a function without a word" };
  }
  if (!ts.isTypeReferenceNode(annotation)) return undefined;

  const name = annotation.typeName.getText();
  const becomes = BECOMES.get(name);
  return becomes === undefined ? undefined : { holds: name, becomes };
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
      `    <${issue.component}> persists \`${issue.field}\`, which holds ${issue.holds} — it arrives as ${issue.becomes}.`,
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

  read(cls, { self }) {
    const found: PersistOfALossyValueIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!hasDecorator(member, "persist")) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const lossy = lossyValueOf(member);
      if (lossy === undefined) continue;

      found.push({ component: self.name, field: member.name.text, ...lossy, ...positionOf(member) });
    }

    return found;
  },
} as const satisfies Rule<PersistOfALossyValueIssue>;
