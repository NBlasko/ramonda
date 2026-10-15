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

/**
 * What a field's element is given for a CONTROLLED field — one with a `value` — and the names of the
 * app's handlers that moves: `listener` on each event in `answered`, calling the app's own through
 * `answer`. A handler spelled another way (`onInput`, `on:input`) is a listener of its own beside it,
 * which is the same thing, since the field is settled after the whole event either way. A field
 * without a `value` is given nothing: with `defaultValue`, or with neither, the page owns what it shows.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function controlled(
  // biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
  component: Component<any>,
  listener: (event: Event) => void,
  answered: readonly ("oninput" | "onchange")[],
) {
  // `null` as much as `undefined`: a value still loading is no value, not the text "null".
  if (component[COMPONENT_RUNTIME].rawProps["value"] == null) return { replaced: [] as string[], listeners: {} };
  const listeners: Record<string, (event: Event) => void> = {};
  for (const name of answered) listeners[name] = listener;
  return { replaced: [...answered], listeners };
}

/** Fields with a settle already set for after the event that is being dispatched. */
const queued = new WeakSet<object>();

/**
 * The app's handler for this event, and then the model's word.
 *
 * A field with a `value` shows what the model says. So after the page has changed it, the handler
 * the app wrote for this event runs — as a listener would, with the element as `this` — and then the
 * field is settled from whatever the model now holds: a handler that took the input leaves the field
 * as the user made it, and one that did not puts the model's value back. A field whose text is only
 * where it starts takes `defaultValue` instead, and is never put back.
 *
 * **After the whole event, not inside it.** A select fires `input` and then `change` for one pick, and
 * every listener on the way up — `<form oninput>` around the field — has to read what the user did; so
 * the settle is set for the next task, after dispatch has finished, and once however many events that
 * task carried. Answering inside the event put the old value back before `change` was read, and before
 * an ancestor saw the input — measured by typing in Chromium.
 *
 * **Not in the middle of a composition.** An input method builds a character over several `input`
 * events, and putting the old value back between them cancels it. Nor when it ends: in Chromium the
 * last `input` of a composition still says `isComposing`, and an app that skips those — the usual
 * way to write it — has not taken the text yet. The field is settled at the next input that is not
 * part of a composition, which the app's handler sees whole.
 *
 * **Only the value is written** — `settle`, not a render: nothing else about the field changed. A
 * field its handler removed has no element left, and `settle` finds nothing to write. A handler that
 * throws still has the value put back: the field must not keep what the model never took.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function answer(component: Component<any> & { settle(): void }, event: Event): void {
  const theirs = component[COMPONENT_RUNTIME].rawProps[`on${event.type}`];
  try {
    // Either form a listener takes: a function, or an object with `handleEvent`.
    if (typeof theirs === "function") theirs.call(event.currentTarget, event);
    else if (typeof (theirs as EventListenerObject | null)?.handleEvent === "function") {
      (theirs as EventListenerObject).handleEvent(event);
    }
  } finally {
    if (!(event as InputEvent).isComposing && !queued.has(component)) {
      queued.add(component);
      setTimeout(() => {
        queued.delete(component);
        component.settle();
      }, 0);
    }
  }
}
