import ts from "typescript";
import { svgElements } from "@ramonda/dom-facts";
import { follow, type Looking } from "./follow-value";
import type { ElementContext, JsxElementLike, WrittenAttribute } from "./rule";

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

/** The attributes written on a TAG, normalised. */
function attributesOf(element: JsxElementLike): WrittenAttribute[] {
  const found: WrittenAttribute[] = [];
  for (const attribute of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText();
    const written = attribute.initializer;
    if (written === undefined) {
      found.push({ name, at: attribute, bare: true });
      continue;
    }
    if (ts.isStringLiteral(written)) {
      found.push({ name, at: attribute, value: written, bare: false });
      continue;
    }
    // `alt={…}` with nothing in the braces is `alt={}`, which carries no value either.
    const inside = ts.isJsxExpression(written) ? written.expression : undefined;
    found.push({ name, at: attribute, ...(inside ? { value: inside } : {}), bare: false });
  }
  return found;
}

/** Builds the context an element rule reads. */
export function contextFor(element: JsxElementLike, resolve: ElementContext["resolve"]): ElementContext {
  const written = openingOf(element).attributes.properties;

  let spreads = false;
  /** Lowercased name → where it sits, against the last spread. */
  const positions = new Map<string, number>();
  let lastSpread = -1;

  for (const [index, attribute] of written.entries()) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      spreads = true;
      lastSpread = index;
      continue;
    }
    // The LAST one written wins, in JSX as in the object it compiles to, so the last position is
    // the one that decides whether a spread can still reach over it.
    positions.set(attribute.name.getText().toLowerCase(), index);
  }

  return build({
    attributes: attributesOf(element),
    at: openingOf(element),
    tag: tagOf(element),
    // The tag as WRITTEN decides this, not the lowercased one: SVG tag names are case-sensitive,
    // and `<clipPath>` is the SVG element while `<clippath>` is an unknown HTML one.
    inSvg: svgElements.has(openingOf(element).tagName.getText()),
    spreads,
    overwritable: (name) => {
      const at = positions.get(name.toLowerCase());
      return at === undefined || at < lastSpread;
    },
    children: ts.isJsxElement(element) ? element.children : [],
    resolve,
  });
}

/**
 * The half of a context that is the same whatever it was built from.
 *
 * `has`, `attr`, `truth` and `number` all read the normalised attribute list, so there is ONE
 * answer per question rather than one per source. That is the lesson the element readers were
 * fixed by twice already: `attr` was taught to follow a name and `stringAttr`, `trueAttr` and the
 * id table's reader were all still literal-only afterwards, because each had its own copy.
 */
function build(parts: Omit<ElementContext, "has" | "attr" | "truth" | "number">): ElementContext {
  /** Lowercased name → the attribute, so a lookup is one map rather than a scan per question. */
  const byName = new Map<string, WrittenAttribute>();
  for (const attribute of parts.attributes) byName.set(attribute.name.toLowerCase(), attribute);

  return {
    ...parts,
    has: (name) => byName.has(name.toLowerCase()),
    attr: (name) => textOf(byName.get(name.toLowerCase()), parts.resolve),
    truth: (name) => truthOf(byName.get(name.toLowerCase()), parts.resolve),
    number: (name) => numberOfAttribute(byName.get(name.toLowerCase()), parts.resolve),
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
 * One attribute read as a STRING, without building the whole context for the element.
 *
 * `contextFor` is documented as computed once per element and shared across the family — so a rule
 * outside that family calling it is a second build of the same thing, per element, for one
 * question. `numberAttr` and `trueAttr` are the same shape for the same reason.
 *
 * `resolve` is REQUIRED here for the reason it is required on `numberAttr`, and the same fault had
 * already happened once: this read only the literal, so `heading-skips-a-level` — its only caller —
 * was wrong in BOTH directions at once. It missed `<div role={HEADING} aria-level={6}>`, and it
 * reported `<h3 role={PRESENTATION}>`, which is not in the outline at runtime and is correct
 * markup. Neither is visible from the rule, whose own line says it reads the role.
 */
export function stringAttr(
  element: JsxElementLike,
  name: string,
  resolve: ElementContext["resolve"],
): string | undefined {
  return textOf(named(attributesOf(element), name), resolve);
}

/** The attribute of that name, whatever the source; the LAST one written, because it wins. */
function named(attributes: readonly WrittenAttribute[], name: string): WrittenAttribute | undefined {
  const wanted = name.toLowerCase();
  let found: WrittenAttribute | undefined;
  for (const attribute of attributes) if (attribute.name.toLowerCase() === wanted) found = attribute;
  return found;
}

/**
 * An attribute as a STRING.
 *
 * `alt="a cat"` and `alt={"a cat"}` are the same fact spelled differently, and `alt={LABEL}` is the
 * same fact one hop away — read, because a rule that saw one and not the others would report a page
 * that is correct. Anything the walk cannot settle on ONE answer for is `undefined`, which is the
 * silence contract.
 *
 * A bare attribute is `{true}` in JSX, which is not a string and not a label.
 */
function textOf(attribute: WrittenAttribute | undefined, resolve: ElementContext["resolve"]): string | undefined {
  if (attribute === undefined || attribute.value === undefined) return undefined;
  if (ts.isStringLiteral(attribute.value)) return attribute.value.text;
  return textBehind(attribute.value, resolve);
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
export function trueAttr(
  element: JsxElementLike,
  name: string,
  resolve: ElementContext["resolve"],
): boolean | undefined {
  return truthOf(named(attributesOf(element), name), resolve);
}

function truthOf(attribute: WrittenAttribute | undefined, resolve: ElementContext["resolve"]): boolean | undefined {
  if (attribute === undefined) return undefined;
  // `aria-hidden` on its own — JSX reads a bare attribute as `{true}`.
  if (attribute.bare) return true;
  const value = attribute.value;
  if (value === undefined) return undefined;
  if (ts.isStringLiteral(value)) return value.text === "true" ? true : value.text === "false" ? false : undefined;
  // `aria-hidden={HIDDEN}` — the fourth spelling of the same fact, and the one that was missed.
  return truthBehind(value, resolve);
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
/**
 * `resolve` is REQUIRED rather than defaulted, and that is the point of it.
 *
 * It was defaulted to a no-op for one commit, and in that commit `tree.ts` built its contexts
 * without one — so every tree rule silently read the old, literal-only answer while its own code
 * said it followed a name. A default here is a guard a caller can forget, and forgetting it looks
 * exactly like a clean codebase.
 */
export function numberAttr(
  element: JsxElementLike,
  name: string,
  resolve: ElementContext["resolve"],
): number | undefined {
  return numberOfAttribute(named(attributesOf(element), name), resolve);
}

function numberOfAttribute(
  attribute: WrittenAttribute | undefined,
  resolve: ElementContext["resolve"],
): number | undefined {
  const written = attribute?.value;
  if (written === undefined) return undefined;

  // `tabIndex="0"` — valid JSX, and the same fact as `{0}`.
  if (ts.isStringLiteral(written)) return numberOf(written.text);
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
  // `tabIndex={PRIORITY}` — the same number, declared elsewhere.
  return numberBehind(written, resolve);
}

/**
 * What an attribute SAYS, when the source settles on one answer — following a name to its
 * declaration.
 *
 * `role={ROLE}` where `const ROLE = "button"` is the same fact as `role="button"`, and the whole
 * accessibility family was blind to it: every element rule reads through `attr`, so one hop away
 * from the literal, forty rules went quiet at once. Measured with `fixtures/one-hop`.
 *
 * **A branch and a call are deliberately NOT followed here**, which is where this differs from the
 * walks that look for a fault. `alt={ok ? "" : "a cat"}` has no single answer, and taking the first
 * arm would report an element that is right half the time — a rule reporting correct markup is how
 * a rule earns being switched off. A module-level `const` DOES count: it is one answer, written
 * once, and where it was written changes nothing about what it says.
 */
const TEXT: Looking<string> = {
  leaf: (expression) => (ts.isStringLiteralLike(expression) ? expression.text : undefined),
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

/** The same, for the attributes that hold a number — `tabIndex`, `aria-level`. */
const NUMBER: Looking<number> = {
  leaf: (expression) => {
    if (ts.isNumericLiteral(expression)) return numberOf(expression.text);
    // `aria-level="6"` is a number where it is written, so a name holding `"6"` is the same fact.
    if (ts.isStringLiteralLike(expression)) return numberOf(expression.text);
    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const magnitude = numberOf(expression.operand.text);
      return magnitude === undefined ? undefined : -magnitude;
    }
    return undefined;
  },
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

/** The three spellings of a claim, behind a name — `{HIDDEN}` where `const HIDDEN = true`. */
const TRUTH: Looking<boolean> = {
  leaf: (expression) => {
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isStringLiteralLike(expression))
      return expression.text === "true" ? true : expression.text === "false" ? false : undefined;
    return undefined;
  },
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

function textBehind(expression: ts.Expression, resolve: ElementContext["resolve"]): string | undefined {
  return follow(expression, resolve, TEXT)?.value;
}

function truthBehind(expression: ts.Expression, resolve: ElementContext["resolve"]): boolean | undefined {
  return follow(expression, resolve, TRUTH)?.value;
}

function numberBehind(expression: ts.Expression, resolve: ElementContext["resolve"]): number | undefined {
  return follow(expression, resolve, NUMBER)?.value;
}

/** A whole number, or `undefined` for anything else — `"1.5"` and `"x"` are both unreadable here. */
function numberOf(text: string): number | undefined {
  const value = Number(text);
  return Number.isInteger(value) ? value : undefined;
}
