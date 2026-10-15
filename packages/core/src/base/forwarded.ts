import type { Component } from "./Component";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "../core/runtime";
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

/** The events whose handler `answering` takes over: the two a field changes through. */
const ANSWERED = ["oninput", "onchange"] as const;

/**
 * The handlers the app wrote for a field's `input` and `change`, each replaced by `listener` — which
 * calls them through `answer`. A field with neither is given neither, and behaves as a plain element:
 * it shows what the user put in, and the model is not consulted.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function answering(component: Component<any>, listener: (event: Event) => void): Record<string, unknown> {
  const { rawProps } = component[COMPONENT_RUNTIME];
  const out: Record<string, unknown> = {};
  for (const name of ANSWERED) if (typeof rawProps[name] === "function") out[name] = listener;
  return out;
}

/** Components with a render already set for after the event that is being dispatched. */
const queued = new WeakSet<object>();

/**
 * The app's handler for this event, and then the model's word.
 *
 * "Controlled" means the field shows what the model says. So after the page has changed the field,
 * the handler the app wrote for this event runs — as a listener would, with the element as `this` —
 * and then the component renders again, which runs `settle` with whatever the model now holds: a
 * handler that took the input leaves the field as the user made it, and one that refused it puts the
 * model's value back.
 *
 * **Only after an event the app handles.** A select fires `input` and then `change` for one pick, and a
 * textarea fires `input` per keystroke and `change` on blur. Answering an event the app wrote nothing
 * for put the old value back BEFORE the event it did write for: `<Select onchange>` read the old value
 * and could not be changed, and `<TextArea onchange>` lost every keystroke.
 *
 * **After the whole event, not inside it.** Every listener on the way up — `<form oninput>` around the
 * field — has to read what the user did, so the render is set for the next task, after dispatch has
 * finished, and once however many of these events that task carried. A handler that throws still gets
 * it: the field must not keep a value the model never took.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function answer(component: Component<any>, event: Event): void {
  const theirs = (component.props as unknown as Record<string, unknown>)[`on${event.type}`];
  try {
    if (typeof theirs === "function") theirs.call(event.currentTarget, event);
  } finally {
    if (!queued.has(component)) {
      queued.add(component);
      setTimeout(() => {
        queued.delete(component);
        component[GLOBAL_RUNTIME].reBuild();
      }, 0);
    }
  }
}
