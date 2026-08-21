import ts from "typescript";
import { memberName } from "../syntax";
import { coreDecoratorName } from "./core-import";
import { openingOf, tagOf } from "./element";
import { follow, type Looking } from "./follow-value";
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

    const returned = only.expression;
    return (
      ts.isPropertyAccessExpression(returned) &&
      returned.name.text === "children" &&
      ts.isPropertyAccessExpression(returned.expression) &&
      returned.expression.name.text === "props" &&
      returned.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    );
  }
  return false;
}

/** The tag `@Host` names — written, or one name away. A callback has no single answer. */
const HOST_TAG: Looking<string> = {
  leaf: (expression) => (ts.isStringLiteralLike(expression) ? expression.text : undefined),
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

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
