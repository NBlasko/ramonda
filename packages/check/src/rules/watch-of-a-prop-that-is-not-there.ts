import ts from "typescript";
import { coreDecoratorName } from "./core-import";
import { memberName, positionOf } from "../syntax";
import type { Rule, RuleContext } from "./rule";

/**
 * `@watchProp` naming a prop the component does not have.
 *
 * The selector is the whole declaration: `@watchProp((p) => p.userId)` says "run this when
 * `userId` changes". Name something that is not a prop and the selector reads `undefined` on every
 * render, which never differs from the `undefined` before it — so the method **never runs**, for
 * the whole life of the component, silently. Nothing throws; the reaction is simply not there, and
 * whatever it was keeping in step drifts.
 *
 * ## Why this is here although `tsc` refuses it
 *
 * Because the refusal is one comment deep. `(p) => p.nope` is `TS2339` — and `(p: any) => p.nope`
 * is not, nor is a `@ts-ignore`, nor a props type that was widened for some unrelated reason three
 * months ago. A type is a defence only while nobody casts it away, and this package's job is what
 * can be PROVED rather than what a compiler would also have said.
 *
 * ## What it reads, and where it goes quiet
 *
 * The props type as SYNTAX, never as a question to the checker: the type argument on
 * `extends Component<…>`, either written out as a literal or naming an interface or alias whose
 * declaration this can find. That covers the two shapes in this repository and, between them,
 * nearly everything anybody writes.
 *
 * It goes quiet — reports nothing at all for that class — on every shape whose members it cannot
 * enumerate with certainty:
 *
 * - **No type argument.** The default props type is `{}` and a component may still be handed
 *   things; nothing here is certain enough to report.
 * - **An index signature** (`[key: string]: unknown`), where every name is a real prop.
 * - **An intersection, a union, a mapped type, a generic parameter**, or an interface that
 *   `extends` something — each has members this cannot see all of, and a partial list would report
 *   props that exist.
 * - **A selector this cannot read.** `(p) => p[key]` and `(p) => pick(p)` name nothing statically.
 *
 * That is the silence contract, and here it is doing most of the work: the cost of being wrong is
 * telling somebody a prop they can see in front of them does not exist.
 */
export interface WatchOfAPropThatIsNotThereIssue {
  /** The component or hook. */
  component: string;
  /** The method the decorator sits on. */
  member: string;
  /** The name the selector read. */
  prop: string;
  /** The props that ARE declared, so the report can show the near miss. */
  declared: readonly string[];
  file: string;
  line: number;
  column: number;
}

/** `key` is added to every component's props by the framework, whatever `P` says. */
const ALWAYS_THERE: ReadonlySet<string> = new Set(["key"]);

/** The type argument on `extends Component<P>` — the props type, as written. */
function propsTypeNode(cls: ts.ClassDeclaration): ts.TypeNode | undefined {
  for (const clause of cls.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    return clause.types[0]?.typeArguments?.[0];
  }
  return undefined;
}

/**
 * The prop names a type node declares, or `undefined` when they cannot all be known.
 *
 * `undefined` is the important half. Every shape whose members this cannot enumerate returns it,
 * and the caller then reports nothing — because a partial list would name a real prop as missing.
 */
function propNamesOf(node: ts.TypeNode | undefined, resolve: RuleContext["resolve"]): ReadonlySet<string> | undefined {
  if (node === undefined) return undefined;

  if (ts.isTypeLiteralNode(node)) return membersOf(node.members);

  if (!ts.isTypeReferenceNode(node)) return undefined;
  // `Props<T>` is a generic instantiation; its members depend on the argument.
  if (node.typeArguments !== undefined) return undefined;

  const declarations = resolve(node.typeName)?.declarations ?? [];

  for (const declaration of declarations) {
    // An interface that extends something has members this cannot see, and a second declaration
    // merged in from elsewhere is the same problem — so both make it go quiet.
    if (ts.isInterfaceDeclaration(declaration)) {
      if (declaration.heritageClauses !== undefined || declarations.length > 1) return undefined;
      return membersOf(declaration.members);
    }
    if (ts.isTypeAliasDeclaration(declaration)) {
      // Only an alias for a literal. An intersection or a union hides members behind another type.
      return ts.isTypeLiteralNode(declaration.type) ? membersOf(declaration.type.members) : undefined;
    }
  }
  return undefined;
}

/** The names in a member list, or `undefined` when one of them makes every name valid. */
function membersOf(members: ts.NodeArray<ts.TypeElement>): ReadonlySet<string> | undefined {
  const found = new Set<string>();

  for (const member of members) {
    // `[key: string]: unknown` — every name is a prop, so nothing can be missing.
    if (ts.isIndexSignatureDeclaration(member)) return undefined;
    if (member.name === undefined) continue;
    if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
      found.add(member.name.text);
      continue;
    }
    // A computed name is one this cannot read, which makes the whole list uncertain.
    return undefined;
  }

  return found;
}

/**
 * The prop a selector reads, or `undefined` when it reads something this cannot name.
 *
 * Three shapes, because all three are written: `(p) => p.userId`, `(p) => p["userId"]`, and
 * `({ userId }) => userId`. Only the FIRST level matters — `(p) => p.user.id` is about the prop
 * `user`, and what is inside it is not this rule's business.
 */
function propReadBy(selector: ts.Expression, resolve: RuleContext["resolve"], depth = 0): string | undefined {
  /**
   * `@watchProp(BY_USER)` — the selector kept in a `const`, which is how anybody with more than
   * three of them writes them. The decorator is handed the same function either way, so it reads
   * the same prop; reading only the literal switched the rule off for that whole style.
   *
   * A `const` only, and only through to a function LITERAL. A `let` can be written again and a call
   * has no single answer, and this rule's cost of being wrong is telling somebody a prop they can
   * see in front of them does not exist.
   */
  if (ts.isIdentifier(selector)) {
    if (depth > 4) return undefined;
    const declaration = resolve(selector)?.declarations?.[0];
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;
    const list = declaration.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return undefined;
    return declaration.initializer === undefined ? undefined : propReadBy(declaration.initializer, resolve, depth + 1);
  }

  if (!ts.isArrowFunction(selector) && !ts.isFunctionExpression(selector)) return undefined;

  const parameter = selector.parameters[0];
  if (parameter === undefined) return undefined;

  // `({ userId }) => …` — the binding names ARE the props read. One at a time, which is how the
  // decorator is written anyway: one selector per value watched.
  if (ts.isObjectBindingPattern(parameter.name)) {
    const first = parameter.name.elements[0];
    if (first === undefined || parameter.name.elements.length !== 1) return undefined;
    const written = first.propertyName ?? first.name;
    return ts.isIdentifier(written) ? written.text : undefined;
  }

  if (!ts.isIdentifier(parameter.name)) return undefined;
  const props = parameter.name.text;

  const body = ts.isBlock(selector.body) ? returnedBy(selector.body) : selector.body;
  if (body === undefined) return undefined;

  if (ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression) && body.expression.text === props) {
    return ts.isIdentifier(body.name) ? body.name.text : undefined;
  }
  if (
    ts.isElementAccessExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === props &&
    ts.isStringLiteralLike(body.argumentExpression)
  ) {
    return body.argumentExpression.text;
  }

  // `p.user.id` reaches here as a property access whose own expression is another one, so the walk
  // above already answered `undefined` for it — deliberately, since the PROP is `user` and that is
  // read one level down. Ask again at that level.
  if (ts.isPropertyAccessExpression(body)) return propOfChain(body, props);

  return undefined;
}

/** The first level of `p.user.id` — the prop, with everything under it ignored. */
function propOfChain(access: ts.PropertyAccessExpression, props: string): string | undefined {
  let at: ts.Expression = access;
  while (ts.isPropertyAccessExpression(at)) {
    if (ts.isIdentifier(at.expression) && at.expression.text === props) {
      return ts.isIdentifier(at.name) ? at.name.text : undefined;
    }
    at = at.expression;
  }
  return undefined;
}

/** The single expression a block body returns, when that is all it does. */
function returnedBy(block: ts.Block): ts.Expression | undefined {
  if (block.statements.length !== 1) return undefined;
  const only = block.statements[0];
  return only !== undefined && ts.isReturnStatement(only) ? only.expression : undefined;
}

export const watchOfAPropThatIsNotThere = {
  id: "watch-of-a-prop-that-is-not-there",

  report: {
    severity: "error",
    reportedWhen:
      "a `@watchProp` selector names something the component's props type does not declare, so the method never runs",
    heading: (found) => `${found.length} \`@watchProp\`(s) watching a prop that is not there:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.member}\` watches \`${issue.prop}\`, which is not a prop — ` +
        `${
          issue.declared.length === 0
            ? "this component declares no props at all"
            : `it declares ${issue.declared.map((name) => `\`${name}\``).join(", ")}`
        }.`,
    ],
    advice:
      "The selector IS the declaration: `@watchProp((p) => p.userId)` says to run the method when\n" +
      "`userId` changes. Naming something that is not a prop makes the selector read `undefined` on\n" +
      "every render, which never differs from the `undefined` before it — so the method never runs,\n" +
      "for the whole life of the component. Nothing throws. The reaction is simply absent, and\n" +
      "whatever it kept in step drifts.\n\n" +
      "Usually it is a rename that reached the props type and not the selector, or a typo. Check the\n" +
      "spelling against the props the report lists.\n\n" +
      "`tsc` refuses this too — until somebody writes `(p: any) => …`, a `@ts-ignore`, or widens the\n" +
      "props type for an unrelated reason. That is why it is checked here as well.\n\n",
  },

  read(cls, { self, resolve }) {
    const declared = propNamesOf(propsTypeNode(cls), resolve);
    // Every shape whose members cannot all be known returns `undefined`, and the whole class is
    // then left alone. A partial list would name a real prop as missing.
    if (declared === undefined) return [];

    const found: WatchOfAPropThatIsNotThereIssue[] = [];
    const names = [...declared].sort();

    for (const member of cls.members) {
      const named = memberName(member);
      if (named === undefined) continue;

      for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call)) continue;
        if (coreDecoratorName(decorator, resolve) !== "watchProp") continue;

        for (const selector of call.arguments) {
          const prop = propReadBy(selector, resolve);
          if (prop === undefined) continue;
          if (declared.has(prop) || ALWAYS_THERE.has(prop)) continue;

          found.push({
            component: self.name,
            member: named,
            prop,
            declared: names,
            ...positionOf(selector),
          });
        }
      }
    }

    return found;
  },
} as const satisfies Rule<WatchOfAPropThatIsNotThereIssue>;
