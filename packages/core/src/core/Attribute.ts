import type { EnhancedHTMLNode } from "../types/vdom";
import { IS_SVG, KEY_SYM, STYLE_SYM, REF_SYM } from "../helpers/constants";
import { checkBooleanAttribute } from "../debug/booleanAttribute";
type NodeAttributes = Record<string, any>;

/**
 * `onServer` skips attaching event listeners, which a server render has no use for.
 *
 * Read from the OWNING COMPONENT's runtime by the caller, not from `getRenderEnv()`. That module-level
 * flag has a contract — only `createComponent` may read it, and only for a root mount — because it is
 * restored before the first `await` and a re-render drained later would see "client" whatever side it
 * is really on. The runtime's `env` is inherited down the tree and stays correct through the drain.
 *
 * Passed as a parameter rather than looked up per attribute: it is one property read per ELEMENT, and
 * the loop below runs per attribute.
 */
export function applyChangesOnAttributes(enhancedNode: ChildNode, rawNextAttributes: NodeAttributes, onServer = false) {
  if (!("tagName" in enhancedNode)) return;

  const previousAttributes = getAllFromNode(enhancedNode as EnhancedHTMLNode);
  const nextAttributes = formatAttributes(rawNextAttributes);
  removePreviousFromenhancedNode(enhancedNode as EnhancedHTMLNode, previousAttributes, nextAttributes);
  attachNextOnenhancedNode(enhancedNode as EnhancedHTMLNode, previousAttributes, nextAttributes, onServer);
  releaseDroppedRef(enhancedNode as EnhancedHTMLNode, nextAttributes.ref);
}

/**
 * Lets go of a ref the JSX has stopped giving this element.
 *
 * `ref` is not a DOM attribute, so it is never among the PREVIOUS attributes read
 * back off the node, and the attach loop only walks the keys present in the NEXT
 * ones. A disappearing `ref` was therefore invisible to both, and the element went
 * on holding the handle — a stale strong reference from the node to a ref nothing
 * points at, and a `current` still aimed at an element the JSX no longer connects
 * it to. A component's ref has behaved correctly since it was unified across
 * create, update and adopt; this is the same rule on the element side.
 *
 * AFTER the attach loop, so what is held is already this render's answer: equal
 * means the ref is still given and there is nothing to do. That ordering is also
 * what keeps the deliberate re-assertion intact — an element applies its ref on
 * every render, which is what makes two elements sharing one fall back to the
 * first when the second goes away.
 *
 * `current === node` for the same reason `releaseRef` checks it: another element
 * may have claimed the ref earlier in this same pass, and clearing then would wipe
 * a value that is now correct.
 */
function releaseDroppedRef(enhancedNode: EnhancedHTMLNode, nextRef: unknown): void {
  const held = enhancedNode[REF_SYM];
  if (held === undefined || held === nextRef) return;

  enhancedNode[REF_SYM] = undefined;
  if (held.current === enhancedNode) held.setCurrent(null);
}

/**
 * camelCase -> the dashed form CSS actually parses. Cached because this runs per
 * styled element per render, and the set of property names an app uses is tiny.
 *
 * Without it every camelCase declaration was **silently dropped** — the browser
 * parses `style.cssText` and discards declarations it cannot read, one by one,
 * with no error. `{ backgroundColor: "red", color: "blue" }` measured as
 * `style="color: blue;"`: half the style gone and nothing said so.
 */
const dashedNames = new Map<string, string>();

function toDashed(name: string): string {
  const cached = dashedNames.get(name);
  if (cached !== undefined) return cached;

  let dashed: string;
  if (name.startsWith("--")) {
    // A custom property is already in its final form and is case-sensitive.
    dashed = name;
  } else {
    dashed = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    // `WebkitTransform` -> `-webkit-transform`: the leading capital produced a
    // leading dash already, so nothing more to do. Kept explicit so the rule is
    // visible rather than an accident of the regex.
  }

  dashedNames.set(name, dashed);
  return dashed;
}

function objectStyleToString(styleObject: Record<string, string>): string {
  let styleString = "";
  for (const key in styleObject) {
    if (styleObject.hasOwnProperty(key)) {
      const value = styleObject[key];
      // A declaration with no value is not a declaration; emitting `key:;` would
      // make the browser drop it, and on some engines the whole rule with it.
      if (value === undefined || value === null || value === "") continue;
      styleString += `${toDashed(key)}: ${value}; `;
    }
  }

  return styleString.trim();
}

export function formatAttributes(attributes: NodeAttributes): Record<string, any> {
  // `class` was already normalized to `className` at vnode creation
  // (createRamonda), so this runs on style only.
  let result = attributes;

  const style = result.style;
  if (style && typeof style !== "string") {
    result = { ...result, style: objectStyleToString(style) };
  }

  return result;
}

function attachNextOnenhancedNode(
  enhancedNode: EnhancedHTMLNode,
  previousAttributes: NodeAttributes,
  nextAttributes: NodeAttributes,
  onServer: boolean,
) {
  for (const name in nextAttributes) {
    if (!nextAttributes.hasOwnProperty(name)) continue;
    const nextAttribute = nextAttributes[name];

    if (isInvisibleOnScreen(nextAttribute)) {
      /**
       * `checked={false}` is not "no attribute" — it is the model saying the box
       * is OFF, and removing the attribute cannot say that. Clicking a checkbox
       * sets its dirty-checkedness flag, after which the attribute no longer
       * drives `.checked` at all, so a box the user ticked stays ticked however
       * many times the model says otherwise. The property is the only thing left
       * that speaks.
       *
       * `false` specifically, not every invisible value: `checked={undefined}`
       * is a control the app is not driving, and forcing it off would take over
       * an uncontrolled box.
       */
      if (nextAttribute === false && name === "checked" && "checked" in enhancedNode) {
        enhancedNode.checked = false;
      }
      continue;
    }

    const previousAttribute = getPreviousFromenhancedNode(enhancedNode, name, previousAttributes[name]);

    if (!attributesEqual(nextAttribute, previousAttribute) || formPropertyDiverged(enhancedNode, name, nextAttribute)) {
      setNextOnenhancedNode(enhancedNode, name, nextAttribute, onServer);
    }
  }
}

/**
 * `value: any` and it stays. This function branches on what the attribute IS — a `ref` object, a
 * listener, a string, a boolean — and each branch hands the value to a DOM API with its own type.
 * Measured: `unknown` here is 11 narrowing casts, one per branch, which moves the looseness rather
 * than removing it. What would actually delete it is a discriminated value, which is a redesign of
 * how a vnode carries attributes.
 */
function setNextOnenhancedNode(enhancedNode: EnhancedHTMLNode, name: string, value: any, onServer: boolean) {
  // Here rather than at vnode creation, because this is where the value is FINAL — anything that
  // was going to normalise it already has.
  if (__DEV__) checkBooleanAttribute(enhancedNode.nodeName, name, value);

  if (name === "ref") {
    // Remembered on the node so unmount can clear it. Without that, `current`
    // kept pointing at a detached element: `if (ref.current) ref.current.focus()`
    // silently did nothing, and the whole subtree stayed reachable.
    const previous = enhancedNode[REF_SYM];
    if (previous && previous !== value) previous.setCurrent(null);
    enhancedNode[REF_SYM] = value ?? undefined;
    value?.setCurrent(enhancedNode);
    return;
  }

  if (name === "value") {
    enhancedNode.value = value;
    enhancedNode.setAttribute(name, value);
    return;
  }

  if (name === "checked") {
    // The property as well as the attribute, for the dirty-checkedness reason
    // above: on a box the user has already clicked, the attribute is inert. The
    // attribute is still written so a server render and a hydrated page agree.
    //
    // `true` for any visible value: a boolean attribute is on when it is
    // PRESENT, so `checked=""` and even the mistaken `checked="false"` (RMD029)
    // mean a ticked box in HTML, and the property has to say the same thing or
    // the two disagree on the same element.
    if ("checked" in enhancedNode) enhancedNode.checked = true;
    enhancedNode.setAttribute(name, value);
    return;
  }

  if (name === "style") {
    enhancedNode.style.cssText = value;
    enhancedNode[STYLE_SYM] = value;
    return;
  }

  if (name === "className") {
    // On an SVG element `className` is a READ-ONLY SVGAnimatedString, so the
    // assignment below throws "which has only a getter" and takes the whole
    // render down. The attribute is `class` on both, and setting it works
    // everywhere — the property is only used on HTML because it is faster.
    if (enhancedNode[IS_SVG]) {
      enhancedNode.setAttribute("class", value);
    } else {
      enhancedNode.className = value;
    }
    return;
  }

  /**
   * The twin of `className`, and it was missing.
   *
   * `concepts/jsx` states the pair as one rule — "`class` and `for` are keywords in JavaScript, so
   * JSX borrows the DOM property names instead: `className` and `htmlFor`" — and only half of it
   * was implemented. Measured before this was written: `<label htmlFor="a">` rendered
   * `htmlfor="a"` and `label.htmlFor` read `""`, because an HTML attribute is written through
   * `setAttribute`, which lowercases the name and has no idea that `htmlfor` was meant to be `for`.
   * The label was associated with nothing, in markup that typechecks and looks right.
   *
   * Written as the ATTRIBUTE rather than through the property, unlike `className` above: `for` is
   * an attribute on `<label>` and `<output>` and nothing else, so the property does not exist to
   * assign on the element somebody may have written it on by mistake.
   */
  if (name === "htmlFor") {
    enhancedNode.setAttribute("for", value);
    return;
  }

  if (name === "key") {
    enhancedNode[KEY_SYM] = value;
    return;
  }

  /**
   * A listener is not an attribute, so `innerHTML` cannot serialize one — which is why attaching on
   * the server was harmless, and why it was left alone for a long time: skipping it looked like it
   * would cost the client a check to save work nobody sees.
   *
   * Measured, and it is worth it. 100 rows with four handlers each — 400 listeners — rendered in
   * 2.104 ms with them attached and 1.222 ms without: **42% of a listener-heavy server render**. The
   * cost on the client is one boolean already in hand, tested inside a branch that was about to make
   * two DOM calls anyway.
   */
  if (name.startsWith("on")) {
    if (onServer) return;

    const type = name.substring(2).toLowerCase();
    enhancedNode._listeners ??= {};
    const listeners = enhancedNode._listeners;

    if (listeners[type]) {
      enhancedNode.removeEventListener(type, listeners[type]);
    }
    listeners[type] = value;
    enhancedNode.addEventListener(type, value);

    return;
  }

  if (enhancedNode[IS_SVG]) {
    enhancedNode.setAttributeNS(null, name, value);

    return;
  }

  enhancedNode.setAttribute(name, value);
}

/** The DOM's name for each attribute the JSX spells differently — read back the way it was written. */
const ALIASED_BACK: Readonly<Record<string, string>> = { class: "className", for: "htmlFor" };

function removeByQualifiedName(enhancedNode: EnhancedHTMLNode, name: string) {
  if (name === "key") {
    enhancedNode[KEY_SYM] = undefined;
    return;
  }
  if (name === "className") {
    // The DOM attribute is `class`; removing "className" would be a no-op.
    enhancedNode.removeAttribute("class");
    return;
  }
  if (name === "htmlFor") {
    // Same again: the DOM attribute is `for`.
    enhancedNode.removeAttribute("for");
    return;
  }
  if (enhancedNode[IS_SVG]) {
    enhancedNode.removeAttributeNS(null, name);
    return;
  }
  enhancedNode.removeAttribute(name);
}

function getPreviousFromenhancedNode(enhancedNode: EnhancedHTMLNode, name: string, value: any) {
  // NOT `style.cssText`: the browser normalizes what it stores, so comparing our
  // generated string against it never matched and the style was re-written on
  // every render. What we last wrote is the only thing worth comparing against.
  // `?? ""`: an element that never had a style must compare equal to an empty
  // one, or the first render writes `style=""` onto every host.
  if (name === "style") return enhancedNode[STYLE_SYM] ?? "";
  return value;
}

/**
 * Whether a form control is SHOWING something other than what the model says.
 *
 * `value` and `checked` are the two attributes that stop describing their
 * element the moment a user touches it: typing changes `input.value` and leaves
 * the attribute where it was, and clicking a checkbox changes `.checked` and
 * makes the attribute inert for good (the dirty-checkedness flag). So an
 * attribute-only diff compares the model against a stale record of itself,
 * agrees, and writes nothing — while the control keeps showing whatever the user
 * left there. The model silently stops being what is on screen.
 *
 * Asked IN ADDITION to the attribute comparison, never instead of it: the
 * attribute is what the element serializes, so it has to stay right for a server
 * render and for anything that reads the markup back.
 *
 * An untouched control's property already equals its attribute, so this answers
 * false for the ordinary case and nothing is written — which matters, because
 * writing `.value` sends the caret to the end and doing that on every unrelated
 * render would be its own bug.
 */
function formPropertyDiverged(enhancedNode: EnhancedHTMLNode, name: string, next: unknown): boolean {
  if (name !== "value" && name !== "checked") return false;
  if (!(name in enhancedNode)) return false;

  const live = (enhancedNode as unknown as Record<string, unknown>)[name];
  // A boolean attribute is on when it is PRESENT, so any visible value means a
  // ticked box — `checked=""` and the mistaken `checked="false"` (RMD029) both.
  if (name === "checked") return live !== true;
  return !attributesEqual(next, live);
}

function getAllFromNode(enhancedNode: EnhancedHTMLNode): Record<string, any> {
  const nodeAttributes: Record<string, any> = {};

  if (enhancedNode._listeners) {
    Object.entries(enhancedNode._listeners).forEach(([key, val]) => {
      const upperCaseKey = `on${key.charAt(0).toUpperCase() + key.slice(1)}`;
      nodeAttributes[upperCaseKey] = val;
    });
  }

  const keyValue = enhancedNode[KEY_SYM];
  if (keyValue != null) nodeAttributes.key = keyValue;

  for (const item of enhancedNode.attributes) {
    // Read back under the name the JSX writes, so a diff compares like with like. Both aliases
    // normalize, because both are written in the source and both arrive here as the DOM's name.
    const name = ALIASED_BACK[item.name] ?? item.name;
    nodeAttributes[name] = item.value;
  }

  return nodeAttributes;
}

function removePreviousFromenhancedNode(
  enhancedNode: EnhancedHTMLNode,
  previousAttributes: NodeAttributes,
  nextAttributes: NodeAttributes,
) {
  for (const name in previousAttributes) {
    const nextAttribute = nextAttributes[name];

    if (!isInvisibleOnScreen(nextAttribute)) continue;

    if (name.startsWith("on")) {
      const type = name.substring(2).toLowerCase();
      const listeners = enhancedNode._listeners ?? {};
      enhancedNode.removeEventListener(type, previousAttributes[name]);
      delete listeners[type];
    } else {
      removeByQualifiedName(enhancedNode, name);
    }
  }
}

function isInvisibleOnScreen(val: unknown): boolean {
  return val === undefined || val === null || val === false;
}

// DOM attribute values are always strings. When both sides are primitives we
// compare their string form so a numeric/boolean next value (e.g. 0, true) is
// not needlessly re-applied against its already-stored string ("0", "true").
// Objects/functions (ref, event handlers) are compared by identity.
function isPrimitive(val: unknown): boolean {
  return val === null || (typeof val !== "object" && typeof val !== "function");
}

function attributesEqual(next: unknown, previous: unknown): boolean {
  if (next === previous) return true;
  if (isPrimitive(next) && isPrimitive(previous)) {
    return String(next) === String(previous);
  }
  return false;
}
