import ts from "typescript";
import { memberName } from "../syntax";
import { coreDecoratorName } from "./core-import";
import { openingOf, tagOf } from "./element";
import { follow, type Looking } from "./follow-value";
import type { HostFact } from "../graph";
import type { JsxElementLike, Resolver } from "./rule";

/**
 * What the HTML content model says about which tag goes inside which.
 *
 * Source: the HTML Living Standard's content models. Only the rules where the parent is a CLOSED
 * set — a `<tr>` has exactly four places it may be, and there is no arguing about it. The looser
 * parts of the content model are left out on purpose: "flow content" and "phrasing content" admit
 * so much that a rule over them would spend its life reporting correct markup.
 *
 * **An ANCESTOR requirement is not a parent requirement**, which is why `<area>` is absent: it needs
 * a `<map>` above it somewhere, and `<map><p><area /></p></map>` is legal. This table is read
 * against the DIRECT parent, so an entry for it would report correct markup.
 */
export const NEEDS_PARENT: Readonly<Record<string, readonly string[]>> = {
  tr: ["table", "thead", "tbody", "tfoot"],
  td: ["tr"],
  th: ["tr"],
  thead: ["table"],
  tbody: ["table"],
  tfoot: ["table"],
  caption: ["table"],
  colgroup: ["table"],
  col: ["colgroup"],
  option: ["select", "optgroup", "datalist"],
  optgroup: ["select"],
  summary: ["details"],
  legend: ["fieldset"],
  figcaption: ["figure"],
  // `<dl>` may wrap its pairs in a `<div>`, which the spec allows explicitly, so a `div` counts.
  dt: ["dl", "div"],
  dd: ["dl", "div"],
  li: ["ul", "ol", "menu"],
  source: ["audio", "video", "picture"],
  track: ["audio", "video"],
  // Ruby annotation. Both go directly inside `<ruby>` and nowhere else — `<rtc>` was the other
  // answer and has been removed from the standard, so the set really is closed.
  rt: ["ruby"],
  rp: ["ruby"],
};

/**
 * Tags that may not contain another of their own kind, and why each is its own fault.
 *
 * A nested one is not a smaller version of the outer: the HTML parser closes the first when it
 * meets the second, so the markup that reaches the page is not the markup that was written. What
 * follows is a click that goes to the wrong place, or a form that submits half of itself.
 */
export const NOT_INSIDE_ITSELF: ReadonlySet<string> = new Set(["a", "button", "form", "label"]);

/**
 * The nearest enclosing JSX element, or `undefined` when this cannot be sure there is one.
 *
 * ## What it walks through, and why each one
 *
 * An expression, a fragment, a conditional and a `&&` all render their contents WHERE THEY SIT, so
 * the tag above them is still the parent: `<table>{ready && <tr />}</table>` puts the row in the
 * table exactly as writing it plainly would.
 *
 * A CALLBACK is walked through too, and that is the one judgement call here. `<tbody>{rows.map(
 * (row) => <tr key={row.id} />)}</tbody>` is how every table in every application is written, and a
 * version of this rule that stopped at the arrow would be silent about tables — which is most of
 * what it exists for. The analyzer already believes this about callbacks elsewhere: `list(each,
 * (item) => <Row />)` is recorded as rendering where the list sits. The cost is a callback that
 * hands its element somewhere else to be mounted, and inside a table that is not a shape anyone
 * writes.
 *
 * ## Where it gives up
 *
 * A function DECLARATION, a class, or the top of the file. At that point the element is a return
 * value and where it lands is decided by whoever calls it — which this cannot see, so it says
 * nothing rather than guess.
 */
export function enclosingElement(element: JsxElementLike): JsxElementLike | undefined {
  let at: ts.Node | undefined = element.parent;

  while (at !== undefined) {
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) return at;

    const transparent =
      ts.isJsxExpression(at) ||
      ts.isJsxFragment(at) ||
      ts.isParenthesizedExpression(at) ||
      ts.isConditionalExpression(at) ||
      ts.isBinaryExpression(at) ||
      ts.isArrowFunction(at) ||
      ts.isCallExpression(at) ||
      ts.isArrayLiteralExpression(at);

    if (!transparent) return undefined;
    at = at.parent;
  }
  return undefined;
}

/** The nearest enclosing HOST tag, `undefined` when there is none or a component is in the way. */
export function enclosingTag(element: JsxElementLike, resolve: Resolver): string | undefined {
  const enclosing = enclosingElement(element);
  if (enclosing === undefined) return undefined;

  const written = tagOf(enclosing);
  // Lowercased to match `tagOf`, which the whole content-model table is keyed by. `hostTagOf` hands
  // the tag back AS WRITTEN, because SVG names are case-sensitive and one caller needs that.
  return written ?? hostTagOfComponent(enclosing, resolve)?.toLowerCase();
}

/**
 * The element a COMPONENT puts around its children, when that is knowable.
 *
 * `<Layout><tr /></Layout>` used to end the walk: what `Layout` renders is decided inside it, and it
 * may well be the `<table>` the row needs. That silence is right for a component whose render puts
 * the children somewhere of its own — and wrong for the commonest shape of all, a wrapper whose
 * render hands `this.props.children` straight back so the HOST element is their parent. Measured:
 * `<Box><tr /></Box>` with `@Host("div")` is a misplaced row and was reported by nothing.
 *
 * Three things all have to hold, and each is a fact in front of the walk rather than a guess:
 *
 * - the tag resolves to a class this program declares
 * - that class's `render()` hands back `this.props.children` and nothing else, so nothing of its own
 *   is between the host and them
 * - its `@Host` names a tag — a literal, or a name holding one. A tag CALLBACK is computed from
 *   props and there is no single answer, so the walk stops exactly as it used to
 */
function hostTagOfComponent(element: JsxElementLike, resolve: Resolver): string | undefined {
  const declared = resolve(openingOf(element).tagName)?.declarations?.[0];
  if (declared === undefined || !ts.isClassDeclaration(declared)) return undefined;
  if (!handsChildrenToTheHost(declared)) return undefined;
  return hostTagOf(declared, resolve);
}

/** Whether `render()` hands back `this.props.children` and nothing else. */
function handsChildrenToTheHost(cls: ts.ClassDeclaration): boolean {
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) || memberName(member) !== "render") continue;

    const body = member.body;
    if (body === undefined || body.statements.length !== 1) return false;

    const only = body.statements[0];
    if (only === undefined || !ts.isReturnStatement(only) || only.expression === undefined) return false;

    return isTheChildren(only.expression);
  }
  return false;
}

/**
 * `this.props.children`, bare or in a fragment that holds nothing else.
 *
 * `return <>{this.props.children}</>` is what a wrapper is usually written as — a fragment adds no
 * element, so the children land on the host either way. Reading only the bare form meant
 * `<LinkBox><a/></LinkBox>` with `@Host("a")` was a link inside a link that nothing reported, and
 * `tag-needs-its-parent` was equally blind through the same wrapper.
 *
 * Nothing else in the fragment, which is what keeps it provable: a sibling beside the children
 * means the host holds more than they do, and this helper's whole claim is that what is written
 * inside the wrapper is what is inside its element.
 */
function isTheChildren(returned: ts.Expression): boolean {
  if (ts.isJsxFragment(returned)) {
    const meaningful = returned.children.filter((child) => !(ts.isJsxText(child) && child.text.trim().length === 0));
    const only = meaningful.length === 1 ? meaningful[0] : undefined;
    if (only === undefined || !ts.isJsxExpression(only) || only.expression === undefined) return false;
    return isTheChildren(only.expression);
  }
  return (
    ts.isPropertyAccessExpression(returned) &&
    returned.name.text === "children" &&
    ts.isPropertyAccessExpression(returned.expression) &&
    returned.expression.name.text === "props" &&
    returned.expression.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

/** The tag `@Host` names — written, or one name away. A callback has no single answer. */
const HOST_TAG: Looking<string> = {
  leaf: (expression) => (ts.isStringLiteralLike(expression) ? expression.text : undefined),
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

/**
 * What `@Host` says this component's element is — a settled tag, or the prop that decides it.
 *
 * The callback form is the half a name cannot answer: `@Host((p) => p.as ?? "div")` is a
 * different element at every call site, so the class says WHICH prop and what it falls back to, and
 * the site says the rest. Only that one shape is read — a single prop, optionally with a `??` or
 * `||` default. A callback reading two props, computing a value, or reaching through a member is not
 * approximated: `undefined` is "not knowable here", and every reader is built to take it that way.
 */
export function hostFactOf(cls: ts.ClassDeclaration, resolve: Resolver): HostFact | undefined {
  const settled = hostTagOf(cls, resolve);
  if (settled !== undefined) return { tag: settled };

  const written = hostArgumentOf(cls, resolve);
  if (written === undefined) return undefined;
  if (!ts.isArrowFunction(written) && !ts.isFunctionExpression(written)) return undefined;

  const parameter = written.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
  const bag = parameter.name.text;

  // A concise body IS the returned expression; a block has to say `return` and nothing else.
  const body = ts.isBlock(written.body)
    ? written.body.statements.length === 1 && ts.isReturnStatement(written.body.statements[0])
      ? written.body.statements[0].expression
      : undefined
    : written.body;
  if (body === undefined) return undefined;

  // `p.as ?? "div"` — the fallback is what the element is when nobody names the prop.
  if (
    ts.isBinaryExpression(body) &&
    (body.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      body.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const prop = propReadIn(body.left, bag);
    const fallback = follow(body.right, resolve, HOST_TAG)?.value;
    return prop === undefined ? undefined : fallback === undefined ? { fromProp: prop } : { fromProp: prop, fallback };
  }

  const prop = propReadIn(body, bag);
  return prop === undefined ? undefined : { fromProp: prop };
}

/**
 * `p.as` — the ONE prop a tag callback reads, when that is all it does.
 *
 * **The parameter IS the props bag, not the component.** `@Host`'s tag callback is typed
 * `(props: PropsOf<C>) => string` and the runtime calls it as `meta.tagFromProps(props ?? {})`.
 * That is not a choice in the signature, it is forced: the diff calls it from `hostTagMatches`
 * BEFORE the component is constructed, so there is no instance to hand it.
 *
 * This read `self.props.as` until a fixture was rewritten to the shape the runtime produces — a
 * shape it then returned nothing for, while happily reporting `as` for a callback that, run, reads
 * a prop named `props` and takes `.as` off whatever that is. Both graph tests failed the moment the
 * fixture stopped inventing its own calling convention.
 */
function propReadIn(expression: ts.Expression, bag: string): string | undefined {
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.name)) return undefined;
  if (!ts.isIdentifier(expression.expression) || expression.expression.text !== bag) return undefined;

  return expression.name.text;
}

/** The first argument to `@Host`, whatever shape it is in. */
function hostArgumentOf(cls: ts.ClassDeclaration, resolve: Resolver): ts.Expression | undefined {
  for (const decorator of ts.getDecorators(cls) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || coreDecoratorName(decorator, resolve) !== "Host") continue;
    return call.arguments[0];
  }
  return undefined;
}

export function hostTagOf(cls: ts.ClassDeclaration, resolve: Resolver): string | undefined {
  for (const decorator of ts.getDecorators(cls) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || coreDecoratorName(decorator, resolve) !== "Host") continue;

    const written = call.arguments[0];
    if (written === undefined) continue;
    return follow(written, resolve, HOST_TAG)?.value;
  }
  return undefined;
}
