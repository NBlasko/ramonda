import ts from "typescript";
import { positionOf } from "../syntax";
import { follow, type Looking } from "./follow-value";
import { hasDecorator, heritage } from "./render-reach";
import type { Rule, RuleContext } from "./rule";

/**
 * A `@memoized` called with something a cache key cannot hold.
 *
 * The decorator caches by its ARGUMENTS, and a key can hold a string, a number or a boolean —
 * exactly those three, which is what `describeUnkeyableArgs` in `base/decorators.ts` decides by.
 * An object cannot: comparing it by value is not something the cache can do, and keying on its
 * identity would miss every time. A fresh object per render would fill the map and hand back a new
 * handler on every pass, which is the churn the decorator exists to prevent.
 *
 * Development throws, so the mistake is not shipped. Production builds the handler and moves on
 * WITHOUT caching that call — the page works and only the memoisation is lost, silently. That
 * second half is what makes a static report worth having: a branch nobody opened in development
 * ships a handler that is rebuilt on every render, and nothing anywhere says so.
 *
 * ## Two shapes, and the second is a stronger claim
 *
 * **A call whose argument is provably unkeyable** — an object or array literal, a function, `null`,
 * `undefined`, a `new`. This is the runtime's own check, made before anything runs.
 *
 * **A parameter ANNOTATED as an object, an array or a function.** Then no call can ever be
 * keyable, so the decorator can never memoise anything at all — a fault in the declaration rather
 * than in one call site.
 *
 * ## The argument is FOLLOWED, not just matched
 *
 * A cast and a parenthesis change nothing about what is passed, and neither do three shapes that
 * were planted here and were all silent: an object built one line up, one a helper returns, and one
 * arm of a ternary. The walk is `follow-value.ts`, shared with `fresh-object-in-props` — it goes to
 * the DECLARATION behind a name, never to its type.
 *
 * A module-level `const` counts here and does not there, which is the one place the two questions
 * part. That rule asks whether a value is REBUILT, so a module const is the fix; this asks what a
 * value IS, and an object built once at module scope is still an object and the runtime still
 * throws for it.
 *
 * ## Where it stays quiet
 *
 * An argument whose declaration this cannot reach: a parameter, a property access, a name nothing
 * in the program declares. `this.pick(row.id)` is fine and `this.pick(row)` is the fault, and those
 * two do look the same from here — telling them apart means asking for a type, which this package
 * does not do. A type reference in an annotation (`arg: Row`) is left alone for the same reason.
 */
export interface UnkeyableMemoizedArgumentIssue {
  /** The component or hook. */
  component: string;
  /** The memoized member — it may hand back a value rather than a handler. */
  member: string;
  /** What was passed, or what the parameter is declared to take. */
  passed: string;
  /** Whether this is one call site or the declaration that makes every call one. */
  where: "a call" | "the declaration";
  file: string;
  line: number;
  column: number;
}

/**
 * What an expression certainly is, when the source says so; `undefined` when it does not.
 *
 * Only shapes that cannot be anything else. An identifier is not one of them HERE — it is handled
 * by the walk below, which follows it to its declaration rather than guessing at its type.
 */
const UNKEYABLE: Looking<string> = {
  leaf: (argument) => {
    if (ts.isObjectLiteralExpression(argument)) return "an object";
    if (ts.isArrayLiteralExpression(argument)) return "an array";
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return "a function";
    if (ts.isNewExpression(argument)) return "an instance";
    if (argument.kind === ts.SyntaxKind.NullKeyword) return "null";
    if (ts.isIdentifier(argument) && argument.text === "undefined") return "undefined";
    return undefined;
  },
  /**
   * A module-level `const` counts, and this is where the two walks part.
   *
   * `fresh-object-in-props` asks whether a value is REBUILT, so a module const is the FIX and it
   * stops there. This asks what a value IS — and an object built once, at module scope, is still an
   * object, still not something a cache key can hold, and the runtime still throws for it.
   */
  throughModuleScope: true,
  /**
   * One arm is enough, and so is one `return`. An object passed on the path taken is an object the
   * cache is handed, and the runtime throws for it on that path.
   */
  throughBranches: true,
  throughCalls: true,
  throughMutableBindings: true,
  throughMemoizedCalls: true,
};

/**
 * What an argument certainly is, following it to where it came from.
 *
 * A cast and a parenthesis change nothing about what is passed, and neither does a local, a helper
 * that returns one, or an arm of a ternary — all four were PLANTED, and all four were silent. The
 * boundary this rule used to state, "an identifier could hold a string", is true of an identifier
 * nothing declares; it is not true of one declared two lines up as `{ id }`.
 *
 * `this.pick(row.id)` is still right and `this.pick(row)` is still the fault, and those two still
 * look the same from here — a parameter, a property access and an unresolvable name all answer
 * `undefined`, which is the silence contract.
 */
function certainlyUnkeyable(written: ts.Expression, resolve: RuleContext["resolve"]): string | undefined {
  return follow(written, resolve, UNKEYABLE)?.value;
}

/** The same question about a parameter's ANNOTATION, which decides every call at once. */
function certainlyUnkeyableType(annotation: ts.TypeNode | undefined): string | undefined {
  if (annotation === undefined) return undefined;
  if (ts.isTypeLiteralNode(annotation)) return "an object";
  if (ts.isArrayTypeNode(annotation) || ts.isTupleTypeNode(annotation)) return "an array";
  if (ts.isFunctionTypeNode(annotation)) return "a function";
  return undefined;
}

export const unkeyableMemoizedArgument = {
  id: "unkeyable-memoized-argument",

  report: {
    severity: "warn",
    reportedWhen:
      "a `@memoized` is called with — or declared to take — something a cache key cannot hold: a key holds a string, a number or a boolean",
    alsoReportedAs: ["RMD047"],
    heading: (found) => `${found.length} @memoized call(s) that cannot be cached:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.member}\` ${
        issue.where === "a call" ? "is called with" : "is declared to take"
      } ${issue.passed} — a cache key holds a string, a number or a boolean.`,
    ],
    advice:
      "`@memoized` caches by its arguments, and a key can hold a string, a number or a\n" +
      "boolean. An object cannot: comparing it by value is not something the cache can do, and\n" +
      "keying on its identity would miss every time — a fresh object per render fills the map and\n" +
      "hands back a new handler on every pass, which is the churn the decorator exists to prevent.\n\n" +
      "Pass the primitive the object stands for — `row.id` rather than `row` — and read the rest\n" +
      "inside the handler, where `this` is in scope anyway.\n\n" +
      "Development throws, so this is not shipped by anybody who ran the branch. Production builds\n" +
      "the handler and moves on WITHOUT caching that call: the page works and only the memoisation\n" +
      "is lost, silently — which is why it is worth saying before anything runs.\n\n" +
      "An argument this cannot read is left alone. `this.pick(row.id)` and `this.pick(row)` look the\n" +
      "same from here, and reporting a maybe is the one thing this package will not do.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    /** name → the handler, for every memoized one THIS class declares. */
    const declaredHere = new Map<string, ts.MethodDeclaration>();
    /**
     * The same, plus the ones a base declares — which is what a CALL has to be matched against.
     *
     * A `@memoized` on a base is the subclass's handler, on the same instance and with the
     * same cache: `this.pick({ id })` down here THROWS `RMD047` at runtime exactly as it would up
     * there. Matching calls against one class body missed every one of them; measured with a plant.
     *
     * The two maps are separate because the halves belong in different places. A DECLARATION is
     * reported where it is written — once — or a base's bad parameter would be reported again for
     * every class extending it, which is the shape this axis has already produced once.
     */
    const memoized = new Map<string, ts.MethodDeclaration>();
    for (const declaring of [cls, ...heritage(cls, resolve)]) {
      for (const member of declaring.members) {
        if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        if (!hasDecorator(member, "memoized", resolve)) continue;
        if (!memoized.has(member.name.text)) memoized.set(member.name.text, member);
        if (declaring === cls) declaredHere.set(member.name.text, member);
      }
    }
    if (memoized.size === 0) return [];

    const found: UnkeyableMemoizedArgumentIssue[] = [];

    // The declaration half first: a parameter that can never be a key makes every call one fault,
    // and saying it once at the declaration is more useful than saying it at each call site.
    for (const [name, method] of declaredHere) {
      for (const parameter of method.parameters) {
        const passed = certainlyUnkeyableType(parameter.type);
        if (passed === undefined) continue;
        found.push({
          component: self.name,
          member: name,
          passed,
          where: "the declaration",
          ...positionOf(parameter),
        });
      }
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(node.expression.name) &&
        memoized.has(node.expression.name.text)
      ) {
        const name = node.expression.name.text;
        for (const argument of node.arguments) {
          const passed = certainlyUnkeyable(argument, resolve);
          if (passed === undefined) continue;
          found.push({ component: self.name, member: name, passed, where: "a call", ...positionOf(argument) });
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const member of cls.members) ts.forEachChild(member, visit);

    return found;
  },
} as const satisfies Rule<UnkeyableMemoizedArgumentIssue>;
