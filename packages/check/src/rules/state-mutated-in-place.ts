import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { stateFieldsOf } from "./render-reach";
import type { Rule } from "./rule";

/**
 * A `@state` array or object changed IN PLACE, so nothing re-renders.
 *
 * A signal fires when it is ASSIGNED a new value, not when the value it already holds changes
 * inside. `this.items.push(row)` and `this.user.name = "x"` both leave the signal holding the same
 * object it was holding a moment ago, so the setter never runs, nothing is scheduled, and the page
 * keeps showing what it showed before. The data is right and the screen is wrong — which reads as
 * "the framework is broken" rather than as a mistake in the code, and is the commonest first
 * impression anybody has of a signal.
 *
 * ## Faithful to the runtime guard, deliberately
 *
 * `debug/mutationGuard.ts` hands out a proxy over `@state` values and reports the same thing as
 * `RMD005` and `RMD048`. This rule mirrors its two boundaries rather than inventing its own, so the
 * two never disagree about a line:
 *
 * - **Only plain objects and arrays.** The guard wraps nothing else: a `Date`, a `Map` or a class
 *   instance goes through untouched, because their methods need the real receiver. So this reports
 *   only a field it can SEE holding an array or an object literal, and says nothing about the rest.
 * - **Only the mutating array methods.** `map`, `filter`, `slice` and iteration pass through the
 *   guard, and `slice()` and a spread return plain arrays — so copy-then-reassign, which is the
 *   fix, is untouched by both halves.
 *
 * ## Everywhere in the class, not only in a render
 *
 * The guard reports wherever the mutation happens, and so does this. A handler is where the fault
 * usually lives, and it is the one place a render-scoped rule would never look.
 */
export interface StateMutatedInPlaceIssue {
  /** The component or hook. */
  component: string;
  /** The state field whose contents were changed. */
  field: string;
  /** What was done to it — `push`, or the property that was written. */
  did: string;
  /** The member it happened in, so a report says where to look. */
  member: string;
  file: string;
  line: number;
  column: number;
}

/**
 * The array methods that change the array. Mirrors `ARRAY_MUTATORS` in `debug/mutationGuard.ts`.
 *
 * Written out again rather than shared, because the two packages have no home for a fact about
 * JavaScript — `@ramonda/dom-facts` is about the DOM. If either list moves, this comment is the
 * pointer to the other.
 */
const MUTATORS: ReadonlySet<string> = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

/**
 * Whether a field is one the runtime guard would wrap: a plain object or array, as written.
 *
 * Read from the initializer, or from an annotation naming an array. Anything else — a call, a name,
 * a `new`, no initializer at all — is a value this cannot see the shape of, and the guard may or
 * may not wrap it. Silence is the only honest answer there, and it is also what keeps a `Date` or a
 * `Map` out of this rule, exactly as the guard keeps them out of its own.
 */
function guardedFields(cls: ts.ClassDeclaration, state: ReadonlySet<string>): ReadonlySet<string> {
  const found = new Set<string>();

  for (const member of cls.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name) || !state.has(member.name.text)) continue;

    const written = member.initializer;
    if (written !== undefined) {
      if (ts.isArrayLiteralExpression(written) || ts.isObjectLiteralExpression(written)) {
        found.add(member.name.text);
      }
      continue;
    }
    // `@state rows: Row[] = …` with no initializer still says it is an array.
    const annotation = member.type;
    if (annotation !== undefined && (ts.isArrayTypeNode(annotation) || ts.isTypeLiteralNode(annotation))) {
      found.add(member.name.text);
    }
  }

  return found;
}

/** `this.<field>` — the shape both faults are written through. */
function stateFieldRead(node: ts.Expression, guarded: ReadonlySet<string>): string | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (node.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  if (!ts.isIdentifier(node.name) || !guarded.has(node.name.text)) return undefined;
  return node.name.text;
}

export const stateMutatedInPlace = {
  id: "state-mutated-in-place",

  report: {
    severity: "warn",
    reportedWhen:
      "a `@state` array or object is changed in place — `this.items.push(…)`, `this.user.name = …` — so the signal never fires",
    alsoReportedAs: ["RMD005", "RMD048"],
    heading: (found) => `${found.length} state value(s) changed in place:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.member}\` changes \`${issue.field}\` in place (${issue.did}) — ` +
        "the signal still holds the same value, so nothing re-renders.",
    ],
    advice:
      "A signal fires when it is ASSIGNED a new value, not when the value it holds changes inside.\n" +
      "So this leaves the signal holding the object it was already holding: the setter never runs,\n" +
      "nothing is scheduled, and the page keeps showing what it showed before. The data is right\n" +
      "and the screen is wrong, which reads as the framework being broken rather than as a mistake\n" +
      "in the code.\n\n" +
      "Replace the value instead of changing it:\n\n" +
      "  this.items = [...this.items, row];      // rather than this.items.push(row)\n" +
      "  this.items = this.items.filter(keep);   // rather than splice\n" +
      "  this.user = { ...this.user, name };     // rather than this.user.name = name\n\n" +
      "`map`, `filter`, `slice` and a spread are all left alone — they return a new value, which is\n" +
      "the fix rather than the fault.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const guarded = guardedFields(cls, stateFieldsOf(cls, resolve));
    if (guarded.size === 0) return [];

    const found: StateMutatedInPlaceIssue[] = [];

    for (const member of cls.members) {
      // A member with no plain name is still walked — the fault is the mutation, not where it sits.
      const named = memberName(member) ?? "the class body";
      // `@created` runs before the first render, and the runtime guard reports there too — see the
      // note on faithfulness above. Nothing is excluded.
      const visit = (node: ts.Node): void => {
        // `this.items.push(row)`
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name;
          const field = stateFieldRead(node.expression.expression, guarded);
          if (field !== undefined && ts.isIdentifier(method) && MUTATORS.has(method.text)) {
            found.push({
              component: self.name,
              field,
              did: `${method.text}()`,
              member: named,
              ...positionOf(node),
            });
          }
        }

        // `this.user.name = "x"` and `this.items[0] = row`
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const target = node.left;
          if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
            const field = stateFieldRead(target.expression, guarded);
            if (field !== undefined) {
              const did = ts.isPropertyAccessExpression(target)
                ? `\`${target.name.getText()}\` written`
                : "an index written";
              found.push({ component: self.name, field, did, member: named, ...positionOf(node) });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      ts.forEachChild(member, visit);
    }

    return found;
  },
} as const satisfies Rule<StateMutatedInPlaceIssue>;
