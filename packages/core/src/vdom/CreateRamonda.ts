import { COMPONENT_TYPE, TEXT_TYPE, ORIGIN_SYM } from "../helpers/constants";
import { currentOrigin } from "../core/origin";
import { diagnose } from "../debug/diagnostics";
import { renderingOwner } from "../debug/renderPhase";
import type { ComponentKind, VNode, VNodeComponent, VNodeString } from "../types/vdom";

/**
 * Ramonda uses `className` everywhere. Normalizing here means once per vnode
 * rather than on every attribute diff of every element — `formatAttributes` runs
 * in the hot path and had to check for `class` on every element, every render,
 * and allocate a fresh attributes object whenever it found one.
 */
/**
 * `class` → `className`, on a COPY.
 *
 * The same rule as the children copy below, and for the same measured reason:
 * writing on the caller's object meant one attributes bag used for two elements
 * came back rewritten. JSX builds a fresh object per element so the compiler never
 * shows it, but `__h` is public and callable. Deleting `class` also swallowed the
 * warning for every later use of that object — the warning is about the SOURCE,
 * and the source still says `class`.
 *
 * The copy costs an allocation only on the path that is already the wrong
 * spelling; correct attributes are handed straight back.
 */
function normalizeClassName(name: ComponentKind, attributes: Record<string, any>): Record<string, any> {
  if (!("class" in attributes)) return attributes;

  if (__DEV__) {
    // Keyed by the component and the tag, not by the word `class`: one report per SITE. A key of
    // `"class"` would report the first of these in an application and none of the rest, for a
    // mistake people make in every file they convert.
    const tag = typeof name === "string" ? name : (name.name ?? "a component");
    const owner = renderingOwner();
    diagnose("RMD039", `${owner}:${tag}`, `\`class\` was given on <${tag}>, from ${owner}.`, { tag, owner });
  }

  const { class: fromClass, ...rest } = attributes;
  if (rest.className === undefined) rest.className = fromClass;
  return rest;
}

export function createRamonda(
  name: ComponentKind,
  rawAttributes: Record<string, any>,
  children: unknown[] = [],
): VNode {
  const attributes = normalizeClassName(name, rawAttributes);

  if (typeof name === "string") {
    const stringNode: VNodeString = {
      type: TEXT_TYPE,
      name,
      attributes,
      children,
      [ORIGIN_SYM]: currentOrigin.id,
    };

    return stringNode;
  }

  // A COPY, not a mutation. Writing `children` onto the caller's object meant a
  // props object used for two elements ended up with only the last one's
  // children — both then rendered the same content. JSX builds a fresh object
  // per element so it never showed there, but `h()` is public and callable
  // directly, and a reused props object is a reasonable thing to write.
  // Measured "twotwo" where "onetwo" was meant.
  const componentNode: VNodeComponent = {
    type: COMPONENT_TYPE,
    name,
    attributes: children.length ? { ...attributes, children } : attributes,
    [ORIGIN_SYM]: currentOrigin.id,
  };

  return componentNode;
}
