import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule, Resolver } from "./rule";

/**
 * A plain function written in tag position.
 *
 * Ramonda's unit is the CLASS. A function has nothing to construct, no state and no lifecycle, so
 * as a tag it names nothing the framework can keep hold of — and `<Thing />` and `Thing()` would
 * mean the same thing written two ways. `RMD011` reports it once the line runs.
 *
 * ## Why a rule, when the compiler refuses most of this
 *
 * Because it refuses two thirds, and the third it lets through is the one people write. Measured on
 * all three shapes against core's own types — `JSX.ElementType` is deliberately undeclared, so
 * TypeScript applies its default rule that a tag must return one `JSX.Element`:
 *
 * | the function returns | the compiler |
 * |---|---|
 * | several nodes | refused, `TS2786` |
 * | anything that is not a node | refused, `TS2786` |
 * | exactly ONE node | **accepted** |
 *
 * A function component written out of habit returns one element. So the likeliest spelling of this
 * fault was the only one nothing typed caught, while two pages said the compiler had already
 * refused it — which is the sentence that stops anybody looking.
 *
 * **None of this is about arrays.** A component returning `[<td/>, <td/>]` is the framework's own
 * headline case and compiles; so does `{rows()}` in an expression slot. Only TAG position is
 * constrained, and only because that is where the default rule applies.
 *
 * The other two shapes are reported here as well rather than left to the compiler. This package is
 * asked to run over projects whose types are loose or absent — it does not typecheck at all, by
 * design — and a rule that answered only where `tsc` is silent would be a rule that changes its
 * mind depending on how somebody configured their build.
 *
 * ## What is NOT reported
 *
 * **A class**, which is a component, which is the point. **An alias for one** — `const Aliased =
 * Card` resolves to the class. **A value read off something** — `<kit.Link />` is not knowable from
 * here, and the router's kit is exactly that shape. **A call in an expression slot** — `{sideBar()}`
 * is the recommended answer, not the fault.
 */
export interface FunctionUsedAsATagIssue {
  /** The tag as written, which is what the reader looks for. */
  tag: string;
  /**
   * Whether the compiler also refuses it — `undefined` when this cannot tell.
   *
   * THREE states, not two, and the third was found by running against a fixture that already
   * existed: `(props) => props.value` as a tag returns a string, so `TS2786` refuses it, and
   * reading only literals said "one node" and printed *the types let this shape through*. Both
   * confident answers are wrong when the return is a name rather than a literal, so the report
   * says nothing about the compiler there rather than guessing which way.
   */
  alsoRefusedByTypes: boolean | undefined;
  file: string;
  line: number;
  column: number;
}

/**
 * The function a tag name resolves to, if it resolves to one at all.
 *
 * A `function` declaration and a `const` holding an arrow are the same mistake written two ways, so
 * both are followed. Anything else — a class, a property access, a parameter, an unresolved name —
 * answers `undefined`, which is the silence contract: a maybe is the one thing this may not report.
 */
function functionBehind(
  tagName: ts.Node,
  resolve: Resolver,
  seen: Set<ts.Node> = new Set(),
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (!ts.isIdentifier(tagName) || seen.has(tagName)) return undefined;
  seen.add(tagName);

  const declaration = resolve(tagName)?.declarations?.[0];
  if (declaration === undefined) return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return undefined;

  const held = declaration.initializer;
  if (ts.isArrowFunction(held) || ts.isFunctionExpression(held)) return held;

  /**
   * An ALIAS is one hop, and the fault survives it.
   *
   * `const Row = SideBar` then `<Row />` is the same function in the same position, and reading
   * only the initializer's shape went silent on it — the exact failure `one-hop-away` exists to
   * catch, in a rule written after that file. Found because the user said the point is that a
   * function must not be callable as a component, which is a claim about the CALL SITE however the
   * name got there.
   *
   * Cycle-guarded: `const A = B; const B = A` terminates rather than recursing.
   */
  return ts.isIdentifier(held) ? functionBehind(held, resolve, seen) : undefined;
}

/**
 * Whether every path out of this function hands back exactly one node — the case the compiler lets
 * through, and the only one where this rule is the sole voice.
 *
 * Read as SYNTAX rather than asked of the checker: an array literal and a non-JSX literal are both
 * written down, and the analyzer deliberately does not typecheck. Anything it cannot read counts as
 * "one node", because that is the answer that keeps the report honest — claiming the compiler also
 * refused something it did not would send a reader looking for an error that is not there.
 */
function returnsSeveralOrNothing(
  fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): boolean | undefined {
  if (fn.body !== undefined && !ts.isBlock(fn.body)) return isNotOneNode(fn.body);

  const answers: (boolean | undefined)[] = [];
  (function look(node: ts.Node): void {
    // A nested function's returns are its own, not this one's.
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined) answers.push(isNotOneNode(node.expression));
    ts.forEachChild(node, look);
  })(fn.body ?? fn);

  // Any path that plainly returns something other than one node settles it. Otherwise a single
  // unreadable return leaves the whole answer unreadable, rather than letting a readable one speak
  // for a path it knows nothing about.
  if (answers.includes(true)) return true;
  return answers.includes(undefined) ? undefined : false;
}

/**
 * Whether the return is plainly NOT one node, plainly one node, or unreadable.
 *
 * `true` for what is written down as not-a-node — an array, a number, a string, an object. `false`
 * for a JSX element, which is one. `undefined` for everything else, because a NAME does not say:
 * `(props) => props.value` returns a string the compiler refuses, and calling that "one node" made
 * the report claim the types allowed something they do not.
 */
function isNotOneNode(expression: ts.Expression): boolean | undefined {
  if (
    ts.isArrayLiteralExpression(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isStringLiteralLike(expression) ||
    ts.isObjectLiteralExpression(expression)
  ) {
    return true;
  }
  return ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)
    ? false
    : undefined;
}

export const functionUsedAsATag = {
  id: "function-used-as-a-tag",

  report: {
    severity: "error",
    reportedWhen:
      "a plain function is written in tag position, where it names nothing the framework can construct — and the compiler only refuses the shapes that do not return exactly one element",
    alsoReportedAs: "RMD011",
    heading: (found) => `${found.length} function(s) written where a component belongs:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} /> is a function, not a component${
        issue.alsoRefusedByTypes
          ? " — the compiler refuses this one too (TS2786)"
          : ", and the types let this shape through"
      }.`,
    ],
    advice:
      "Ramonda's unit is the class. A function has nothing to construct, no state and no lifecycle,\n" +
      "so in tag position it names nothing the framework can hold on to.\n\n" +
      "For markup you want to reuse without state, call the function in an expression slot —\n" +
      "`{sideBar()}` — where it reads as the value it is. For state or lifecycle with no markup of\n" +
      "its own, that is a Hook. For both, make it a component.\n\n" +
      "The compiler catches part of this by itself: `JSX.ElementType` is left undeclared, so its\n" +
      "default rule applies and a tag returning several nodes, or anything that is not a node, is\n" +
      "`TS2786`. What it accepts is a function returning exactly ONE element — which is how a\n" +
      "function component gets written by habit, and why this rule exists.\n\n" +
      "None of this restricts arrays. A component returning several nodes is the ordinary case, and\n" +
      "so is `{rows()}`. Only tag position is constrained.\n\n",
  },

  read(element, { resolve }) {
    const opening = openingOf(element);
    const fn = functionBehind(opening.tagName, resolve);
    if (fn === undefined) return [];

    return [
      {
        tag: opening.tagName.getText(),
        alsoRefusedByTypes: returnsSeveralOrNothing(fn),
        ...positionOf(opening),
      },
    ];
  },
} as const satisfies ElementRule<FunctionUsedAsATagIssue>;
