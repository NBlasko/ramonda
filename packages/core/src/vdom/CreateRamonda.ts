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
function normalizeClassName(name: ComponentKind, attributes: Record<string, any>): void {
  if (!("class" in attributes)) return;

  if (__DEV__) {
    // Keyed by the component and the tag, not by the word `class`: one report per SITE. A key of
    // `"class"` would report the first of these in an application and none of the rest, for a
    // mistake people make in every file they convert.
    const tag = typeof name === "string" ? name : (name.name ?? "a component");
    const owner = renderingOwner();
    diagnose("RMD038", `${owner}:${tag}`, `\`class\` was given on <${tag}>, from ${owner}.`, { tag, owner });
  }

  if (attributes.className === undefined) attributes.className = attributes.class;
  delete attributes.class;
}

export function createRamonda(name: ComponentKind, attributes: Record<string, any>, children: unknown[] = []): VNode {
  normalizeClassName(name, attributes);

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
