import ts from "typescript";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import { follow, type Looking } from "./follow-value";
import type { Rule } from "./rule";

/**
 * A name in a hook's props bag that the hook does not take.
 *
 * `this.use(Head, () => ({ title, robots: "noindex" }))` type-checks, runs, and renders no robots
 * tag: the hook never reads a name it does not know. Found by an agent that built an app from the
 * docs alone and learned it only by fetching the served page.
 *
 * ## Why the type check does not catch it
 *
 * TypeScript refuses a name an object literal's type lacks only where the type is known BEFORE the
 * literal is read. A props callback is the opposite case: the hook's props type is a type parameter
 * of `use()`, inferred partly FROM the bag, so the extra name is absorbed rather than refused.
 * Measured on the real packages: `Head({ robots })` and `Query({ staleTimee })` both pass `tsc`.
 * Making the signature refuse them was measured too: the message is `'string' is not assignable to
 * type 'never'`, and `Query` stopped inferring its data type from `fetch`. So this is a rule.
 *
 * ## What the hook takes is read off its TYPE
 *
 * The second parameter of the hook's constructor, which is what `use()` itself matches the bag
 * against. That reaches every hook the same way: one in this project, one from an installed
 * package through its `.d.ts`, a Provider from `createContext`, a generic one (`Query<TData>`'s
 * names do not depend on `TData`).
 *
 * ## What is reported, and what is not
 *
 * Only a name WRITTEN in an object literal — `robots: …`, a shorthand, a method. A bag that is not
 * a literal (`self.bag`) may carry more than the hook takes on purpose, and is the type checker's
 * business. The literal is followed where it is reached from, through a local, a module constant,
 * a helper in another file and either arm of a branch, because the question is what the bag IS and
 * one path that hands a wrong name is enough.
 *
 * Silent where the type cannot say a name is wrong: props typed `any`, or with an index
 * (`Record<string, unknown>`), or a hook with no such parameter. A union of shapes takes every name
 * any of its members takes. A computed name is not read.
 */
export interface UnknownHookOptionIssue {
  /** The class writing the `use`. */
  component: string;
  /** The hook, as written. */
  hook: string;
  /** The name it does not take. */
  option: string;
  /** The name it probably meant, when one is close enough to be a typo. */
  meant: string | undefined;
  /** Every name it does take, sorted, for a report with no guess. */
  takes: string[];
  /** Where the bag was written, when that is not the `use` line. */
  writtenIn: string | undefined;
  file: string;
  line: number;
  column: number;
}

/** A literal that names something the hook does not take, and the properties that do. */
interface Wrong {
  literal: ts.ObjectLiteralExpression;
  names: ts.ObjectLiteralElementLike[];
}

/** The name a property is written with, when it is written plainly. */
function writtenName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isSpreadAssignment(property)) return undefined;
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** What the walk looks for: a literal with a name not in `takes`. A literal without one keeps it going. */
function lookingFor(takes: ReadonlySet<string>): Looking<Wrong> {
  return {
    leaf: (expression) => {
      if (!ts.isObjectLiteralExpression(expression)) return undefined;
      const names = expression.properties.filter((property) => {
        const name = writtenName(property);
        return name !== undefined && !takes.has(name);
      });
      return names.length === 0 ? undefined : { literal: expression, names };
    },
    // The question is what the bag IS: a module constant still hands the wrong name, a `let` still
    // holds the literal it was given, and one arm of a branch that hands it is enough.
    throughModuleScope: true,
    throughBranches: true,
    throughCalls: true,
    throughMutableBindings: true,
    throughMemoizedCalls: true,
  };
}

/** Every expression a callback hands back: a concise body, or each `return` of its own. */
function everyReturn(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] {
  if (!ts.isBlock(fn.body)) return [fn.body];
  const found: ts.Expression[] = [];
  (function look(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
    ts.forEachChild(node, look);
  })(fn.body);
  return found;
}

/**
 * Edits from one name to the other — a letter added, dropped, changed, or two swapped. The typos an
 * option name gets: `staleTimee`, `evry`, `evrey`, `color` for `colour`.
 */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The one name close enough to be what was meant — none when two are equally close. */
function closest(name: string, takes: readonly string[]): string | undefined {
  const allowed = Math.max(1, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestAt = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const candidate of takes) {
    const at = distance(name.toLowerCase(), candidate.toLowerCase());
    if (at < bestAt) {
      best = candidate;
      bestAt = at;
      tied = false;
    } else if (at === bestAt) {
      tied = true;
    }
  }
  return best !== undefined && bestAt <= allowed && !tied ? best : undefined;
}

export const unknownHookOption = {
  id: "unknown-hook-option",

  report: {
    severity: "error",
    reportedWhen:
      "a hook's props callback names an option the hook does not take — a typo, or a name from another library — which the hook never reads and the type check lets through",
    heading: (found) => `${found.length} option(s) a hook does not take:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> gives ${issue.hook} \`${issue.option}\`${
        issue.writtenIn === undefined ? "" : `, in the bag written in ${issue.writtenIn}`
      }, and ${issue.hook} has no such option${
        issue.meant !== undefined
          ? `: did you mean \`${issue.meant}\`?`
          : issue.takes.length > 0 && issue.takes.length <= 16
            ? `. It takes ${issue.takes.map((name) => `\`${name}\``).join(", ")}.`
            : "."
      }`,
    ],
    advice:
      "A hook reads only the options its type names, so an unknown one is ignored: nothing renders,\n" +
      "nothing fetches, and nothing says so. The type check cannot see it, because a props callback\n" +
      "is where the hook's type is inferred from the bag. Rename the option, or find on the hook's page\n" +
      'where the thing you meant is set — `Head` takes a robots tag as `meta: [{ name: "robots", … }]`.\n\n',
  },

  read(cls, { self, resolve }) {
    const found: UnknownHookOptionIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      const call = member.initializer;
      if (call === undefined || !ts.isCallExpression(call) || !isThisUse(call)) continue;
      const factory = call.arguments[1];
      if (factory === undefined || !(ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) continue;

      const hook = hookNamed(call.arguments[0]);
      const options = resolve.hookOptions(hook);
      if (options === undefined) continue;
      const takes = new Set(options);
      const sorted = [...options].sort();
      const how = lookingFor(takes);

      const reported = new Set<ts.ObjectLiteralExpression>();
      for (const returned of everyReturn(factory)) {
        const wrong = follow(returned, resolve, how);
        if (wrong === undefined || reported.has(wrong.value.literal)) continue;
        reported.add(wrong.value.literal);
        for (const property of wrong.value.names) {
          const option = writtenName(property) as string;
          found.push({
            component: self.name,
            hook: hook.getText(),
            option,
            meant: closest(option, sorted),
            takes: sorted,
            writtenIn: wrong.foundIn,
            ...positionOf(property),
          });
        }
      }
    }

    return found;
  },
} as const satisfies Rule<UnknownHookOptionIssue>;
