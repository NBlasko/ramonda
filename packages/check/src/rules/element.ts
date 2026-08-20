import ts from "typescript";
import { svgElements } from "@ramonda/dom-facts";
import type { ElementContext, JsxElementLike } from "./rule";

/**
 * What every element rule reads, computed once per element rather than once per rule.
 *
 * Forty accessibility rules asking "does this have an `alt`" would otherwise walk the same
 * attribute list forty times. They ask this instead, and it walks it once.
 */

/** The opening half of an element, which is where the attributes are. */
export function openingOf(element: JsxElementLike): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

/**
 * The tag when it is a host element, lowercased; `undefined` when it names a component.
 *
 * A capital first letter is a component, and so is any dotted name (`<screens.reader />`) — that is
 * JSX's own rule, and it is what separates markup from a value reference. Lowercased because HTML
 * is case-insensitive about tags while JSX is not, and a rule about `<img>` should not be defeated
 * by `<IMG>`.
 */
export function tagOf(element: JsxElementLike): string | undefined {
  const name = openingOf(element).tagName.getText();
  if (/^[A-Z]/.test(name) || name.includes(".")) return undefined;
  return name.toLowerCase();
}

/** Builds the context an element rule reads. */
export function contextFor(element: JsxElementLike): ElementContext {
  const attributes = openingOf(element).attributes.properties;

  let spreads = false;
  /** Lowercased name → the attribute, so a lookup is one map rather than a scan per question. */
  const byName = new Map<string, ts.JsxAttribute>();

  for (const attribute of attributes) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      spreads = true;
      continue;
    }
    byName.set(attribute.name.getText().toLowerCase(), attribute);
  }

  const tag = tagOf(element);

  return {
    tag,
    // The tag as WRITTEN decides this, not the lowercased one: SVG tag names are case-sensitive,
    // and `<clipPath>` is the SVG element while `<clippath>` is an unknown HTML one.
    inSvg: svgElements.has(openingOf(element).tagName.getText()),
    spreads,
    children: ts.isJsxElement(element) ? element.children : [],
    has: (name) => byName.has(name.toLowerCase()),
    attr: (name) => {
      const found = byName.get(name.toLowerCase());
      if (!found) return undefined;

      // `alt` with no value at all is `alt={true}` in JSX, which is not a string and not a label.
      const value = found.initializer;
      if (value === undefined) return undefined;
      if (ts.isStringLiteral(value)) return value.text;

      /**
       * `alt={"a cat"}` — a literal that happens to be written in braces.
       *
       * Read because it is the same fact spelled differently, and a rule that saw one and not the
       * other would report a page that is correct. Anything else in the braces is an expression
       * this cannot evaluate, and `undefined` is the honest answer to it.
       */
      if (ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression)) {
        return value.expression.text;
      }
      return undefined;
    },
  };
}

/**
 * Whether an element has anything inside it a screen reader would read out.
 *
 * Text, or an expression, or a nested element — anything but whitespace and comments. Deliberately
 * generous: this answers "is it EMPTY", and the rules that use it report emptiness, which is the
 * part that can be proved. Whether the text inside is a good label is a different question and not
 * one a checker should have an opinion about.
 */
export function hasContent(children: readonly ts.JsxChild[]): boolean {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.text.trim().length > 0;
    // `{" "}` and `{}` are not content; anything else in braces might be.
    if (ts.isJsxExpression(child)) {
      if (child.expression === undefined) return false;
      if (ts.isStringLiteralLike(child.expression)) return child.expression.text.trim().length > 0;
      return true;
    }
    return true;
  });
}

/**
 * An attribute read as a claim of TRUE — `aria-hidden`, `aria-hidden={true}`, `aria-hidden="true"`.
 *
 * Three spellings of one fact, and the framework renders all three the same: a bare JSX attribute
 * IS `true`, and every one of them reaches the element as `aria-hidden="true"`. Reading only the
 * string missed the two shorter ones, which is measured — `<button aria-hidden>` hides a focusable
 * button and was reported by nothing.
 *
 * `undefined` for anything that is not one of the three, which is the silence contract:
 * `aria-hidden={busy}` may be either and a rule that guessed would report the correct half of it.
 */
export function trueAttr(element: JsxElementLike, name: string): boolean | undefined {
  for (const attribute of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText().toLowerCase() !== name.toLowerCase()) continue;

    const value = attribute.initializer;
    // `aria-hidden` on its own — JSX reads a bare attribute as `{true}`.
    if (value === undefined) return true;
    if (ts.isStringLiteral(value)) return value.text === "true" ? true : value.text === "false" ? false : undefined;
    if (!ts.isJsxExpression(value) || value.expression === undefined) return undefined;

    const written = value.expression;
    if (written.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (written.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isStringLiteralLike(written))
      return written.text === "true" ? true : written.text === "false" ? false : undefined;
    return undefined;
  }
  return undefined;
}

/**
 * An attribute read as a NUMBER — `tabIndex={0}`, `tabIndex="0"`, `tabIndex={-1}`.
 *
 * `attr` deliberately answers only for strings, because for most rules in this family a number is
 * not the kind of value being asked about. Two rules ask about exactly one number, `tabIndex`, and
 * they must agree about what it says: one reports a POSITIVE one and the other reports a
 * non-negative one, so a disagreement about how `{-1}` is spelled would make the pair contradict
 * itself on the same line.
 *
 * `undefined` for anything that is not a literal, which is the silence contract: `tabIndex={index}`
 * inside a list is a number this cannot know.
 */
export function numberAttr(element: JsxElementLike, name: string): number | undefined {
  for (const attribute of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText().toLowerCase() !== name.toLowerCase()) continue;

    const value = attribute.initializer;
    if (value === undefined) return undefined;

    // `tabIndex="0"` — valid JSX, and the same fact as `{0}`.
    if (ts.isStringLiteral(value)) return numberOf(value.text);

    if (!ts.isJsxExpression(value) || value.expression === undefined) return undefined;

    const written = value.expression;
    if (ts.isNumericLiteral(written)) return numberOf(written.text);

    // `{-1}` is a prefix expression rather than a literal, which is the whole reason this exists.
    if (
      ts.isPrefixUnaryExpression(written) &&
      written.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(written.operand)
    ) {
      const magnitude = numberOf(written.operand.text);
      return magnitude === undefined ? undefined : -magnitude;
    }
    return undefined;
  }
  return undefined;
}

/** A whole number, or `undefined` for anything else — `"1.5"` and `"x"` are both unreadable here. */
function numberOf(text: string): number | undefined {
  const value = Number(text);
  return Number.isInteger(value) ? value : undefined;
}
