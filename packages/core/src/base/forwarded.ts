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
 * What a field's element is given, and the names of the app's handlers that moves.
 *
 * A CONTROLLED field — one with a `value` — gets `listener` on each event in `answered`, calling the
 * app's own through `answer`. A handler spelled another way (`onInput`, `on:input`) is a listener of
 * its own beside it, which is the same thing, since the field is settled after the whole event
 * either way. A field without a `value` is the page's: it gets `uncontrolled` on the same events when
 * it needs to hear them — a `Select` notes the user's pick — and nothing otherwise.
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
    composing.delete(component);
    unfinished.delete(component);
    const listeners: Record<string, (event: Event) => void> = {};
    if (uncontrolled !== undefined) for (const name of answered) listeners[name] = uncontrolled;
    return { replaced: Object.keys(listeners), listeners };
  }
  // The composition's start and end too: a settle set before a composition began must not land in it.
  const listeners: Record<string, (event: Event) => void> = {
    oncompositionstart: listener,
    oncompositionend: listener,
  };
  for (const name of answered) listeners[name] = listener;
  return { replaced: Object.keys(listeners), listeners };
}

/** The app's own handler for this event, called as a listener would be: a function, or `handleEvent`. */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function heard(component: Component<any>, event: Event): void {
  const theirs = component[COMPONENT_RUNTIME].rawProps[`on${event.type}`];
  if (typeof theirs === "function") theirs.call(event.currentTarget, event);
  else if (typeof (theirs as EventListenerObject | null)?.handleEvent === "function") {
    (theirs as EventListenerObject).handleEvent(event);
  }
}

/**
 * Whether a field whose composition ended still needs the word handed to it: it is on the page, and
 * the model does not hold what it shows. A handler that takes composing input as well took the word
 * from the last one, and is not called again for it; a field the composition's end took away — Enter
 * closed the dialog — is sent nothing.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function lacksTheWord(component: Component<any>, field: EventTarget): boolean {
  const element = field as HTMLTextAreaElement;
  if (!element.isConnected) return false;
  const model = component[COMPONENT_RUNTIME].rawProps["value"];
  return model == null || String(model) !== element.value;
}

/** Fields an input method is composing in right now. */
const composing = new WeakSet<object>();

/** Fields with a settle already set for after the event that is being dispatched. */
const queued = new WeakSet<object>();

/**
 * Fields whose composition has ended with no ordinary `input` after it yet: the element, and the word
 * it ended with. See "When it ends" on `answer`.
 */
const unfinished = new WeakMap<object, { field: EventTarget; word: string }>();

/*
 * TODO(webkit): measure the end of a composition in Safari, on a Mac.
 *
 * Chromium and Firefox are measured with a real composition (see "When it ends" on `answer`); WebKit
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
 * which is what this code has to answer. Delete this note once it is measured.
 */

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
 * events, and putting the old value back between them cancels it. A settle set by an input just
 * BEFORE a composition began is asked again when it runs, and skipped while one is under way.
 *
 * **When it ends, every browser hands the word over the same way.** The usual handler skips composing
 * input, `if (event.isComposing) return;`, and takes the word from the ordinary `input` that follows.
 * Measured: Firefox sends one — `compositionend`, then `input` with `isComposing: false` and
 * `insertCompositionText`, in the same task. Chromium does not: its last `input` still says
 * `isComposing`, and nothing follows `compositionend`, so that handler never took the word and the
 * settle put the old text back. So a field whose composition ended with no ordinary `input` after it,
 * by the time the settle runs, is sent that `input` — the one Firefox sends — and settled after it.
 * Where the browser sends its own, nothing is sent twice, whichever order it uses; and it is sent only
 * while the model lacks the word (`lacksTheWord`).
 *
 * **Only the value is written** — `settle`, not a render: nothing else about the field changed. A
 * field its handler removed has no element left, and `settle` finds nothing to write. A handler that
 * throws still has the value put back: the field must not keep what the model never took.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function answer(component: Component<any> & { settle(): void }, event: Event): void {
  try {
    heard(component, event);
  } finally {
    if (event.type === "compositionstart") {
      composing.add(component);
      unfinished.delete(component);
    } else if (event.type === "compositionend") {
      composing.delete(component);
      const field = event.currentTarget;
      if (field !== null) unfinished.set(component, { field, word: (event as CompositionEvent).data ?? "" });
    } else if (event.type === "input" && !(event as InputEvent).isComposing) {
      unfinished.delete(component);
    }
    if (event.type !== "compositionstart" && !(event as InputEvent).isComposing && !queued.has(component)) {
      queued.add(component);
      setTimeout(() => {
        queued.delete(component);
        // Asked again when it runs: a composition may have started since this was set.
        if (composing.has(component)) return;
        const ended = unfinished.get(component);
        unfinished.delete(component);
        if (ended !== undefined && lacksTheWord(component, ended.field)) {
          // Its own answer sets the settle, after every listener has had the word.
          const input = { bubbles: true, composed: true, inputType: "insertCompositionText", data: ended.word };
          ended.field.dispatchEvent(new InputEvent("input", input));
          return;
        }
        component.settle();
      }, 0);
    }
  }
}
