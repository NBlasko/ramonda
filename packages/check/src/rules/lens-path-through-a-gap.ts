import ts from "typescript";
import { positionOf } from "../syntax";
import { importedFromPackage } from "./core-import";
import { guardedBy, type Means } from "./guard-walk";
import type { ModuleContext, ModuleRule } from "./rule";

/**
 * A `focusOn` path that walks THROUGH a value the types say may be missing.
 *
 * Only the LAST hop of a lens path creates what it names. `focusOn(state).get("profile").set(p)`
 * writes a profile whether or not one was there; `focusOn(state).get("profile").get("name")` has
 * to walk through the profile to reach the name, and if `profile` is `null` there is nothing to
 * walk. The lens does not invent the intermediate object — it reports `RML001` and changes
 * nothing, which since this version THROWS in development.
 *
 * ## Why a rule, when there is already a runtime code for it
 *
 * Because of which branch it is on. A path through a gap is written for the state as the author
 * pictures it — a profile that is loaded, an address that is filled in — and the gap is the case
 * they were not picturing: a fresh account, a failed fetch, the first render. So the runtime code
 * fires on the user's machine, in the state nobody set up locally, and the rule fires on the line
 * as it is typed. That is the pair {@link Report.alsoReportedAs} exists to name.
 *
 * TypeScript does not object, and that is not a gap in the types. `Focus<T>`'s `get` is keyed on
 * `keyof T`, and `keyof (Profile | null)` still offers `name` — the chain type-checks because the
 * chain is legal. Whether the value is THERE is a question about the value.
 *
 * ## What it can prove, and where it goes quiet
 *
 * This package may not ask the compiler for a type: the program is built with `noLib` and `types`
 * overridden, and `resolve` — where a name was DECLARED — is the whole of what it asks. So the path
 * is read from DECLARATIONS and from type annotations as written:
 *
 * - the root of the chain has to resolve to something with a written annotation (a `const`, a
 *   parameter, a `@state` field) or be `this.field` on the class the chain is written in;
 * - each hop's property has to be found on an interface or a type literal reachable from there;
 * - "may be missing" is `profile?: Profile` or `profile: Profile | null` — the annotation, as
 *   written.
 *
 * Everything else stops the walk without a word: an inferred type, a generic, an array element, an
 * indexed access, a type from a package whose declaration this run did not load. That is the
 * package's standing bar — report what is proven, go quiet otherwise — and it is why this is
 * narrow. It catches the shape that is actually written, not every path that could be one.
 *
 * Two silences are worth naming because they LOOK like the shape this reports and are not:
 *
 * - **A nullable type ALIAS.** `type Maybe = Profile | null` with `profile: Maybe` puts the gap one
 *   name away, and the annotation on the property says nothing about it. Following it would mean
 *   deciding what an alias resolves to, which is the type question this package does not ask.
 * - **A NAMESPACE import.** `import * as lens from "@ramonda/lens"` writes the call as
 *   `lens.focusOn(state)`, and the chain's foot is then a property access rather than the
 *   identifier the package check reads.
 * - **A chain held in a variable.** `const at = focusOn(state).get("profile").get("name")` ends in
 *   a hop rather than a write, and whether it is ever written through is a question about the
 *   variable. See {@link WRITE_TERMINALS}, which is also what keeps a READ out of this: `value()`
 *   through a gap answers `undefined` by design and is not a fault at all.
 *
 * Both are misses, not false reports, and that is the direction this package errs in on purpose.
 *
 * ## What silences it
 *
 * A guard that proves the value is there. `if (state.profile)`, `!== null`, `!= null`, `&&`, a
 * ternary, and the early return — the four shapes `guard-walk` already knows, because narrowing is
 * exactly what makes the write correct:
 *
 *     if (state.profile) focusOn(state).get("profile").get("name").set("Ada");
 *
 * The guard has to be about the same path. `if (other.profile)` proves nothing about this one, and
 * the comparison is on the path as written — `state.profile`, `this.data.profile` — because a rule
 * that matched on the last name alone would go quiet on the wrong object.
 */
export interface LensPathThroughAGapIssue {
  /** The chain's root as written — `state`, `this.data`. */
  root: string;
  /** The hop that may be missing — `profile`. */
  hop: string;
  /** The path up to and including that hop, as a reader would write it: `state.profile`. */
  path: string;
  /** The hop that cannot be reached through it — the next one along. */
  beyond: string;
  /** How the annotation says it may be missing: `optional`, `null`, or `undefined`. */
  admits: "optional" | "null" | "undefined";
  file: string;
  line: number;
  column: number;
}

/** The hops that WALK a path. A terminal (`set`, `merge`, `value`) is not one of these. */
const PATH_HOPS = new Set(["get", "at"]);

/**
 * The terminals that WRITE, which is the only kind of chain this reports.
 *
 * A read through a gap is not a fault and is not `RML001`: `value()` answers `undefined` and
 * `values()` answers an empty array, both by documented design, and neither reports anything. The
 * rule said otherwise until this set existed — it told an author to fix a line that was correct,
 * which is the one failure this package cannot afford.
 *
 * The list is what `Focus` returns `Root` from: those are the calls that produce a new state, so
 * those are the calls that had to walk the path to build it. Anything else — a read, an unfinished
 * chain held in a variable, a method added later that this does not know — goes quiet. A chain
 * ending in `.get(…)` and assigned to a name is the notable miss: it may be written through
 * elsewhere, and following it would mean tracking the variable.
 */
const WRITE_TERMINALS = new Set(["set", "update", "merge", "remove", "and", "push", "insert"]);

/** One `.get("key")` / `.at(0)` in a chain, in source order. */
interface Hop {
  /** The method — `get` or `at`. */
  kind: string;
  /** The key as written, when it is a literal; `undefined` for anything computed. */
  key: string | undefined;
  /** The `.get` identifier, so a report points at the hop rather than at the whole chain. */
  at: ts.Node;
}

/**
 * The chain a `focusOn` call grows, read from the outside in.
 *
 * A chain is a left-leaning tree — `focusOn(s).get("a").get("b")` parses as `((focusOn(s)).get("a")).get("b")`
 * — so the OUTERMOST call is the last hop written. This walks down to the `focusOn` call and hands
 * the hops back in source order, which is the order a path is walked.
 */
function chainOf(
  outermost: ts.CallExpression,
  context: ModuleContext,
): { root: ts.Expression; hops: Hop[] } | undefined {
  // The terminal first: a chain that does not end in a write is not this rule's business, and
  // deciding that here means the walk below never runs for one.
  const end = outermost.expression;
  if (!ts.isPropertyAccessExpression(end) || !WRITE_TERMINALS.has(end.name.text)) return undefined;

  const hops: Hop[] = [];
  let node: ts.Expression = outermost;

  while (ts.isCallExpression(node)) {
    const callee = node.expression;

    /**
     * The bottom of the chain: `focusOn(root)`, and it has to be the LENS's `focusOn`.
     *
     * By where the binding came from, not by the name — the standing lesson of `core-import.ts`,
     * which every rule that reads a framework name goes through. An app is entitled to a `focusOn`
     * of its own, and one judged by these semantics would be reported for somebody else's rules.
     * The alias is covered by the same call: `import { focusOn as lens }` reaches here under the
     * name the MODULE exports.
     */
    if (ts.isIdentifier(callee)) {
      if (node.arguments.length !== 1) return undefined;
      if (!importedFromPackage(callee, "@ramonda/lens", context.resolveLocal, context.resolveStep, "focusOn")) {
        return undefined;
      }
      hops.reverse();
      return { root: node.arguments[0]!, hops };
    }

    if (!ts.isPropertyAccessExpression(callee)) return undefined;

    if (PATH_HOPS.has(callee.name.text)) {
      const argument = node.arguments[0];
      hops.push({
        kind: callee.name.text,
        key: argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : undefined,
        at: callee.name,
      });
    }
    /**
     * A hop this does not know — `where`, `set`, `value` — is not pushed, and the walk continues
     * down to the root.
     *
     * Dropping `where` cannot make a later hop look like a child of the wrong type, and that is
     * worth checking rather than hoping: `where` narrows an ARRAY, so any hop after one was reached
     * through an array — and an array type ends the walk, because `membersOf` has no members to give
     * for it. Same for `at`, which is not looked up as a property either. Measured on
     * `apps/docs/src/demos/LensSharing.tsx`, whose four chains are all
     * `get("posts").where(…).get(…)`: the walk stops at `posts` and says nothing.
     */

    node = callee.expression;
  }

  return undefined;
}

/** `state` / `this.data` / `this.data.inner`, as a reader would write it — or `undefined` if it is not that shape. */
function pathText(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const before = pathText(node.expression);
  return before === undefined ? undefined : `${before}.${node.name.text}`;
}

/**
 * The type annotation the root of a chain was DECLARED with.
 *
 * `this.field` is read from the enclosing class, because a field is declared where the chain is
 * written and no resolution is needed to find it. Everything else goes through `resolve`, and
 * anything without a written annotation — an inferred `const`, a destructured parameter — answers
 * `undefined` and ends the walk.
 */
function declaredTypeOf(root: ts.Expression, resolve: ModuleContext["resolve"]): ts.TypeNode | undefined {
  if (ts.isPropertyAccessExpression(root) && root.expression.kind === ts.SyntaxKind.ThisKeyword) {
    const cls = enclosingClass(root);
    const field = cls?.members.find(
      (member) =>
        ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === root.name.text,
    );
    return field !== undefined && ts.isPropertyDeclaration(field) ? field.type : undefined;
  }

  if (!ts.isIdentifier(root)) return undefined;
  const declaration = resolve(root)?.declarations?.[0];
  if (declaration === undefined) return undefined;
  if (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration)) {
    return declaration.type;
  }
  return undefined;
}

function enclosingClass(node: ts.Node): ts.ClassDeclaration | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at)) return at;
  }
  return undefined;
}

/**
 * The members of a type, when this can see them at all.
 *
 * An interface and a type literal both have them written down. A type REFERENCE is followed once,
 * through `resolve`, to whichever of the two it names — which is the hop that makes a real app's
 * `AppState` readable, since a state type is declared once and referred to everywhere.
 */
function membersOf(
  type: ts.TypeNode | undefined,
  resolve: ModuleContext["resolve"],
): ts.NodeArray<ts.TypeElement> | undefined {
  if (type === undefined) return undefined;
  if (ts.isTypeLiteralNode(type)) return type.members;

  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return undefined;
  // A generic instantiation is not followed: its members would be the declaration's, with the
  // arguments unsubstituted, and substituting them is asking for a type.
  if (type.typeArguments !== undefined) return undefined;

  const declaration = resolve(type.typeName)?.declarations?.[0];
  if (declaration === undefined) return undefined;
  if (ts.isInterfaceDeclaration(declaration)) return declaration.members;
  if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) return declaration.type.members;
  return undefined;
}

/** How an annotation says a value may be missing, or `undefined` when it does not say so. */
function admission(member: ts.PropertySignature): "optional" | "null" | "undefined" | undefined {
  if (member.questionToken !== undefined) return "optional";
  const type = member.type;
  if (type === undefined || !ts.isUnionTypeNode(type)) return undefined;
  for (const part of type.types) {
    if (part.kind === ts.SyntaxKind.UndefinedKeyword) return "undefined";
    if (ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword) return "null";
  }
  return undefined;
}

/** The part of a union that is not `null` or `undefined` — what the path continues into. */
function withoutTheGap(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (type === undefined || !ts.isUnionTypeNode(type)) return type;
  const real = type.types.filter(
    (part) =>
      part.kind !== ts.SyntaxKind.UndefinedKeyword &&
      !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword),
  );
  // Two real arms is a union this cannot walk without choosing one, which is a type question.
  return real.length === 1 ? real[0] : undefined;
}

function propertyNamed(
  members: ts.NodeArray<ts.TypeElement> | undefined,
  key: string,
): ts.PropertySignature | undefined {
  return members?.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === key,
  );
}

/**
 * Whether a condition proves the path at `text` holds a value — and its opposite.
 *
 * Both directions are needed rather than one and a negation, for the reason `guard-walk` states:
 * a condition can say this, the opposite of this, or nothing at all. `if (state.profile) …` and
 * `if (!state.profile) return;` are the same proof reached from opposite sides, and a condition
 * about some other path is neither.
 */
function narrowing(text: string, resolve: ModuleContext["resolve"]): Means {
  /**
   * The path itself, or a `const` that was read out of it.
   *
   * `const profile = state.profile; if (profile) …` is how the guard is ordinarily written, and
   * without this the rule reported the write inside it — a false alarm on correct code, which is
   * the one direction this package cannot afford. `const` is what makes it sound: the local cannot
   * be reassigned, so its truthiness is the path's at the moment it was read.
   */
  const isPath = (node: ts.Expression): boolean => {
    const bare = stripParens(node);
    if (pathText(bare) === text) return true;
    if (!ts.isIdentifier(bare)) return false;
    const declaration = resolve(bare)?.declarations?.[0];
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
    if (declaration.initializer === undefined || !isConstDeclaration(declaration)) return false;
    return pathText(declaration.initializer) === text;
  };

  /**
   * A LONGER path through this one, which truthiness alone proves: `state.profile?.name` can only
   * be truthy if `state.profile` is there.
   *
   * Truthiness ONLY. A comparison does not carry the same proof — `state.profile?.name !== null` is
   * true when the profile is missing, because `undefined !== null` — so this is deliberately not
   * reached from the `!==` arm below.
   */
  const isThroughPath = (node: ts.Expression): boolean => {
    const longer = pathText(stripParens(node));
    return longer !== undefined && longer.startsWith(`${text}.`);
  };

  /** `Boolean(x)`, and only the global one: a name declared in this project resolves, the lib's does not. */
  const asBooleanCall = (node: ts.Expression): ts.Expression | undefined => {
    if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "Boolean") return undefined;
    return resolve(node.expression) === undefined ? node.arguments[0] : undefined;
  };

  const proves = (condition: ts.Expression): boolean => {
    const node = stripParens(condition);
    if (isPath(node) || isThroughPath(node)) return true;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      return refutes(node.operand);
    }
    const boolean = asBooleanCall(node);
    if (boolean !== undefined) return proves(boolean);
    if (ts.isBinaryExpression(node)) {
      const { operatorToken: op, left, right } = node;
      // `a && b` proves the path when either side does: both have to hold for the guarded code to run.
      if (op.kind === ts.SyntaxKind.AmpersandAmpersandToken) return proves(left) || proves(right);
      if (isNotEqual(op.kind)) return isPath(left) ? isEmptiness(right) : isPath(right) && isEmptiness(left);
    }
    return false;
  };

  const refutes = (condition: ts.Expression): boolean => {
    const node = stripParens(condition);
    /**
     * The bare path is NOT a refutation, and reading it as one is the bug this comment replaces.
     *
     * `denies` licenses the OTHER branch — the `else`, the false arm of a ternary, the code after
     * an early return. So `denies(state.profile)` claiming true said that `if (state.profile)
     * return;` proves a profile below it, when that line proves the exact opposite: below it, the
     * profile is gone. Four shapes went silent on the strongest instance of the fault there is —
     * the branch where the gap is PROVEN. A `!` is already handled by the recursion below, which is
     * what the line was reaching for.
     */
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      return proves(node.operand);
    }
    const boolean = asBooleanCall(node);
    if (boolean !== undefined) return refutes(boolean);
    if (ts.isBinaryExpression(node)) {
      const { operatorToken: op, left, right } = node;
      if (op.kind === ts.SyntaxKind.BarBarToken) return refutes(left) || refutes(right);
      if (isEqual(op.kind)) return isPath(left) ? isEmptiness(right) : isPath(right) && isEmptiness(left);
    }
    return false;
  };

  return { holds: proves, denies: refutes };
}

/** Whether a variable was declared `const`, which is what makes reading a path into it a proof. */
function isConstDeclaration(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

/** `null` or `undefined`, as the other side of a comparison. */
function isEmptiness(node: ts.Expression): boolean {
  const bare = stripParens(node);
  return bare.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(bare) && bare.text === "undefined");
}

function isEqual(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken;
}

function isNotEqual(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsToken;
}

export const lensPathThroughAGap = {
  id: "lens-path-through-a-gap",

  /**
   * The lens has to be in the project for the question to exist, and `needs` is the gate for it —
   * decided from imports, once, like every other rule's.
   */
  needs: "@ramonda/lens",

  report: {
    /**
     * A WARNING, and not because the fault is mild — `RML001` is an `error` and now throws in
     * development. Because it is a NEW rule, which the repository answers the same way every time:
     * a gate that fails a build over something nobody has seen yet is a gate somebody switches off.
     * It becomes an error in a later version.
     */
    severity: "error",
    reportedWhen:
      "a `focusOn` write walks through a hop the types say may be `null` or `undefined`, which only the LAST hop creates",
    alsoReportedAs: "RML001",
    heading: (found) => `${found.length} lens path(s) that walk through a value that may be missing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`${issue.path}\` is declared ${
        issue.admits === "optional" ? "optional" : `as \`| ${issue.admits}\``
      }, and the path continues into \`.${issue.beyond}\``,
      `    through it. Only the last hop creates what it names, so if \`${issue.hop}\` is missing`,
      `    nothing is written.`,
    ],
    advice:
      "A lens path CREATES its last hop and walks every hop before it. So this is safe:\n\n" +
      '    focusOn(state).get("profile").set({ name: "Ada" })       // creates the profile\n\n' +
      "and this is not, when `profile` may be missing:\n\n" +
      '    focusOn(state).get("profile").get("name").set("Ada")     // walks through it\n\n' +
      "There are two ways out, and which one is right depends on what a missing value means:\n\n" +
      "**Prove it is there.** If the code already runs only when it is, say so and the report stops:\n\n" +
      '    if (state.profile) focusOn(state).get("profile").get("name").set("Ada");\n\n' +
      "**Write the whole object.** If a missing value should be filled in, do it in one hop:\n\n" +
      '    focusOn(state).get("profile").merge({ name: "Ada" })\n\n' +
      "Reported from the ANNOTATION as written — `profile?: Profile` or `profile: Profile | null`. A\n" +
      "type this cannot read from the source says nothing, and nothing is reported for it.",
  },

  read(file, context) {
    const found: LensPathThroughAGapIssue[] = [];

    /**
     * Whether this call is an INNER link of a longer chain, in which case the outer one covers it.
     *
     * A chain is judged once, from its outermost call. An inner call is the `expression` of the
     * property access the next hop is written on — `focusOn(s).get("a")` inside
     * `focusOn(s).get("a").get("b")`.
     */
    const isInnerLink = (node: ts.CallExpression): boolean => {
      const parent = node.parent;
      return (
        parent !== undefined &&
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.parent !== undefined &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      );
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && !isInnerLink(node)) {
        const chain = chainOf(node, context);
        if (chain !== undefined) report(chain.root, chain.hops);
      }

      ts.forEachChild(node, visit);
    };

    const report = (root: ts.Expression, hops: Hop[]): void => {
      const rootText = pathText(root);
      if (rootText === undefined) return;

      let members = membersOf(declaredTypeOf(root, context.resolve), context.resolve);
      let path = rootText;

      for (let index = 0; index < hops.length; index += 1) {
        const hop = hops[index]!;
        // `.at(0)` on an array, or a computed key: neither names a property this can look up, and
        // the path cannot be followed past it.
        if (hop.kind !== "get" || hop.key === undefined) return;

        const property = propertyNamed(members, hop.key);
        if (property === undefined) return;
        path = `${path}.${hop.key}`;

        const next = hops[index + 1];
        const admits = admission(property);

        /**
         * A gap is a fault only when the path continues THROUGH it and nothing proves it is there.
         *
         * The last hop is the one the lens creates, so a gap there is correct code. A guarded gap
         * is correct too — and the walk CARRIES ON past it rather than stopping, which is the
         * difference between reading the guard as an answer about this hop and reading it as an
         * answer about the whole path. Found by planting: with a `return` here, a proven `profile`
         * hid an optional `address` two hops along, and the deeper gap was reported by nothing.
         */
        if (admits !== undefined && next !== undefined && !guardedBy(hop.at, narrowing(path, context.resolve))) {
          found.push({
            root: rootText,
            hop: hop.key,
            path,
            beyond: next.key ?? next.kind,
            admits,
            ...positionOf(hop.at),
          });
          return;
        }

        members = membersOf(withoutTheGap(property.type), context.resolve);
      }
    };

    visit(file);

    return found;
  },
} as const satisfies ModuleRule<LensPathThroughAGapIssue>;
