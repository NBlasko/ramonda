import type { Component } from "./Component";
import { COMPONENT_RUNTIME } from "../core/runtime";
import { answerEdit, callHandler, forgetField, type Transform } from "../core/field";
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
 * What a field's element is given, and the names of the app's handlers that moves.
 *
 * A CONTROLLED field — one with a `value` — gets `listener` on each event in `answered`, calling the
 * app's own through `answer`. A handler written `on:input` is the field's own as much as `oninput`
 * is, as on a plain `<input>`: it is taken off the element too and called by the field, after the
 * edit is decided — so a refused edit reaches neither. A field without a `value` is the page's: it
 * gets `uncontrolled` on the same events when it needs to hear them — a `Select` notes the user's
 * pick — and nothing otherwise.
 */
export function controlled(
  // biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
  component: Component<any>,
  listener: (event: Event) => void,
  answered: readonly ("oninput" | "onchange")[],
  uncontrolled?: (event: Event) => void,
) {
  // `null` as much as `undefined`: a value still loading is no value, not the text "null".
  if (component[COMPONENT_RUNTIME].rawProps["value"] == null) {
    // A composition it let go of in the middle ends with the app, not here, and must not leave the
    // field waiting for that end once it holds a value again.
    forgetField(component);
    const listeners: Record<string, (event: Event) => void> = {};
    if (uncontrolled !== undefined) for (const name of answered) listeners[name] = uncontrolled;
    return { replaced: Object.keys(listeners), listeners };
  }
  // The composition's start and end too: a settle set before a composition began must not land in it.
  // And the blur, which a composition can be lost to with no end of its own.
  const listeners: Record<string, (event: Event) => void> = {
    oncompositionstart: listener,
    oncompositionend: listener,
    onblur: listener,
  };
  for (const name of answered) listeners[name] = listener;
  // `on:input` beside `oninput`, and so on: each is called by `answer`, none is attached.
  const replaced = Object.keys(listeners).flatMap((name) => [name, `on:${name.slice(2)}`]);
  return { replaced, listeners };
}

/** The app's own handler for this event, called as a listener would be — see `callHandler`. */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function heard(component: Component<any>, event: Event): void {
  callHandler(component[COMPONENT_RUNTIME].rawProps[`on${event.type}`], event);
}

/*
 * TODO(webkit): measure the end of a composition in Safari, on a Mac.
 *
 * Chromium and Firefox are measured with a real composition (see "When it ends" on `answerEdit` in
 * `core/field.ts`); WebKit
 * is not — there is no driver here that types through an input method in it. The code does not
 * depend on the order a browser uses, so it should hold, but nothing has shown that it does.
 *
 * Chromium is checked by `apps/playground-core/browser/fields.spec.ts`, Firefox by
 * `browser/firefox-composition.mjs`, both against the playground's `/fields` page.
 *
 * 1. System Settings → Keyboard → Input Sources: add Japanese – Romaji.
 * 2. Build the playground, `vite preview` it, and open `/fields` in Safari.
 * 3. In each of the two text fields, switch to Japanese, type `nihon`, Space, Enter.
 *
 * Right: both fields keep 日本; the first readout is `["日本"]`, and the second ends in 日本 with no
 * 日本 that Safari did not send itself. Wrong: a field comes back empty, or the first readout has 日本
 * twice — then log `input` and `compositionend` on the field to see the order Safari sends them in,
 * which is what this code has to answer.
 *
 * 4. Type `nihon` again and, before Enter, press Tab to leave the field. Right: the word is kept, or
 *    the field shows the model — never an empty field. Wrong: an empty field, which means Safari sends
 *    `compositionend` after the blur and something wrote the field in between — see "A composition
 *    lost" on `answerEdit`.
 *
 * Delete this note once it is measured.
 */

/**
 * A `Select` or a `TextArea` answering an edit — see `answerEdit`, which a plain `<input>` answers
 * through as well. The model is the component's `value`; its handlers are its props.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function answer(component: Component<any> & { settle(): void }, event: Event, pick = false): void {
  const runtime = component[COMPONENT_RUNTIME];
  answerEdit(
    {
      key: component,
      pick,
      model: () => runtime.rawProps.value,
      prev: () => {
        const model = runtime.rawProps.value;
        return Array.isArray(model) ? model.map(String) : String(model ?? "");
      },
      transform: () => {
        const transform = runtime.rawProps.transform;
        return typeof transform === "function" ? (transform as Transform) : undefined;
      },
      own: (type, own) => {
        // Both spellings, in the order a listener would be: `oninput`, then `on:input`.
        callHandler(runtime.rawProps[`on${type}`], own);
        callHandler(runtime.rawProps[`on:${type}`], own);
      },
      settle: () => component.settle(),
      gone: () => runtime.isDestroyed === true,
    },
    event,
  );
}
