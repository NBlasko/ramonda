import type { Component } from "./Component";
import { COMPONENT_RUNTIME } from "../core/runtime";
import type { ComponentChild, RamondaNode } from "../types/vdom";

/**
 * What a component that OWNS one element needs in order to be transparent.
 *
 * `<Select>` and `<TextArea>` both stand in front of a tag whose state is not an attribute, and both
 * have to pass everything else through untouched. Shared rather than written twice: the reason
 * either of them works is subtle enough that two copies would drift apart without anybody noticing.
 *
 * Both spell their private members with one letter — `e` for the element, `h` and `g` for the ref
 * hand-over — because a class member is NOT minified: it reaches the bundle written as it stands,
 * once per use. Each carries a comment naming it, since the identifier no longer can. Measured on
 * those two components: 84 bytes raw and 5 gzipped, a repeated name costing almost nothing once it
 * compresses.
 */

/**
 * `children` as the factory's rest parameter wants it: no children at all rather than one child that
 * is `undefined`. JSX makes that distinction by writing nothing; a call has to make it by hand.
 */
export function given(children: RamondaNode | undefined): ComponentChild[] {
  return children === undefined ? [] : [children as ComponentChild];
}

/**
 * Every prop except the ones this component consumes, read so its signal exists.
 *
 * The props proxy has no `ownKeys` trap — deliberately, because a signal is made per KEY as that key
 * is read, and that is what lets a component depend on exactly the props it looked at. The
 * consequence is that `{...this.props}` spreads nothing at all, so a wrapper written the obvious way
 * silently drops every attribute its caller wrote.
 *
 * The names are on `rawProps`, which is replaced just before the render that will use it, so at this
 * moment they are this render's. Reading each one back THROUGH the proxy is what makes the wrapper
 * reactive to it — so this component does depend on all of them, which is right for something whose
 * whole job is to pass them on.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function forwarded(component: Component<any>, consumed: readonly string[]): Record<string, unknown> {
  const { rawProps } = component[COMPONENT_RUNTIME];
  const props = component.props as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(rawProps)) {
    if (name === "key" || consumed.includes(name)) continue;
    out[name] = props[name];
  }
  return out;
}
