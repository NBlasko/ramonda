import type { EnhancedHTMLNode } from "../types/vdom";
import { IS_SVG, KEY_SYM, STYLE_SYM, REF_SYM } from "../helpers/constants";
type NodeAttributes = Record<string, any>;

export function applyChangesOnAttributes(enhancedNode: ChildNode, rawNextAttributes: NodeAttributes) {
  if (!("tagName" in enhancedNode)) return;

  const previousAttributes = getAllFromNode(enhancedNode as EnhancedHTMLNode);
  const nextAttributes = formatAttributes(rawNextAttributes);
  removePreviousFromenhancedNode(enhancedNode as EnhancedHTMLNode, previousAttributes, nextAttributes);
  attachNextOnenhancedNode(enhancedNode as EnhancedHTMLNode, previousAttributes, nextAttributes);
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
) {
  for (const name in nextAttributes) {
    if (!nextAttributes.hasOwnProperty(name)) continue;
    const nextAttribute = nextAttributes[name];

    if (isInvisibleOnScreen(nextAttribute)) continue;

    const previousAttribute = getPreviousFromenhancedNode(enhancedNode, name, previousAttributes[name]);

    if (!attributesEqual(nextAttribute, previousAttribute)) {
      setNextOnenhancedNode(enhancedNode, name, nextAttribute);
    }
  }
}

function setNextOnenhancedNode(enhancedNode: EnhancedHTMLNode, name: string, value: any) {
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

  if (name === "key") {
    enhancedNode[KEY_SYM] = value;
    return;
  }

  // This runs on the server too: renderToString mounts through this same path
  // under a DOM shim (hydration/ssr.ts), so listeners really are attached to
  // shim nodes and then thrown away. Harmless by construction — listeners are
  // not attributes, so innerHTML cannot serialize them — and skipping it would
  // mean ADDING an environment check to the client's hot path to save work on
  // the server. See "Client/server split without a runtime `if`" in TODO.md.
  if (name.startsWith("on")) {
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

function getAllFromNode(enhancedNode: EnhancedHTMLNode): Record<string, any> {
  const nodeAttributes: Record<string, any> = {};

  if (enhancedNode._listeners) {
    Object.entries(enhancedNode._listeners).forEach(([key, val]: any) => {
      const upperCaseKey = `on${key.charAt(0).toUpperCase() + key.slice(1)}`;
      nodeAttributes[upperCaseKey] = val;
    });
  }

  const keyValue = enhancedNode[KEY_SYM];
  if (keyValue != null) nodeAttributes.key = keyValue;

  for (const item of enhancedNode.attributes) {
    const name = item.name === "class" ? "className" : item.name;
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
