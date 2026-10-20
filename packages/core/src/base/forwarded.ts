import type { Component } from "./Component";
import { COMPONENT_RUNTIME } from "../core/runtime";
import { drainSync } from "../core/Task";
import { decideEdit } from "../core/transform";
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
    fields.delete(component);
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
  return { replaced: Object.keys(listeners), listeners };
}

/** The app's `transform` on a `Select` or `TextArea`, against the model its `value` holds — see `decideEdit`. */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function transformAtSource(component: Component<any>, event: Event): void {
  const transform = component[COMPONENT_RUNTIME].rawProps.transform;
  const field = event.currentTarget as HTMLTextAreaElement | HTMLSelectElement | null;
  if (typeof transform !== "function" || field === null) return;
  const model = component[COMPONENT_RUNTIME].rawProps.value;
  const prev = Array.isArray(model) ? model.map(String) : String(model ?? "");
  decideEdit(field, transform as Parameters<typeof decideEdit>[1], prev, event);
}

/** The app's own handler for `type` on the field, called as a listener would be: a function, or `handleEvent`. */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function callOwn(component: Component<any>, type: string, event: Event): void {
  const theirs = component[COMPONENT_RUNTIME].rawProps[`on${type}`];
  if (typeof theirs === "function") theirs.call(event.currentTarget, event);
  else if (typeof (theirs as EventListenerObject | null)?.handleEvent === "function") {
    (theirs as EventListenerObject).handleEvent(event);
  }
}

/** The app's own handler for this event — see `callOwn`. */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function heard(component: Component<any>, event: Event): void {
  callOwn(component, event.type, event);
}

/** What one controlled field is in the middle of: a composition, or a pick. */
interface FieldState {
  /** An input method is composing in the field right now. */
  composing: boolean;
  /** The field lost the focus in the middle of the composition — see "A composition lost" on `answer`. */
  blurred: boolean;
  /** What the model held when the composition began, and whether it has left it since. */
  composedFrom?: unknown;
  composedMoved: boolean;
  /** The word the field's handler was handed when its composition ended — see "When it ends" on `answer`. */
  handedOver?: string;
  /** A select's pick was answered on its `input`, so its `change` has nothing left to do. */
  picked: boolean;
}

/** Every controlled field's state, one record each, so no two pieces of it can disagree. */
const fields = new WeakMap<object, FieldState>();

// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function stateOf(component: Component<any>): FieldState {
  let state = fields.get(component);
  if (state === undefined) {
    fields.set(component, (state = { composing: false, blurred: false, composedMoved: false, picked: false }));
  }
  return state;
}

// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
const modelOf = (component: Component<any>): unknown => component[COMPONENT_RUNTIME].rawProps["value"];

/**
 * Whether the model says the same as before. A `multiple` select's `value` is an array, and one
 * rebuilt each render (`value={[...this.picked]}`) is a new object with the same members — it has not
 * moved.
 */
function sameModel(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  // As the select reads it: which options are chosen, in any order — the same set both ways.
  const before = new Set(a.map(String));
  const after = new Set(b.map(String));
  return before.size === after.size && [...before].every((member) => after.has(member));
}

/**
 * Whether a field's own `settle` leaves the value alone for now: an input method is composing in it.
 * An autosave flipping `disabled` in the middle of a word, and writing the model then, cancels the
 * word being typed. Asked by the field when a render reaches it from `@updated`.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function settlesLater(component: Component<any>): boolean {
  return fields.get(component)?.composing === true;
}

/** Notes it when the model is somewhere else than where the composition found it. */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function noteMovement(component: Component<any>, state: FieldState): void {
  if (!sameModel(modelOf(component), state.composedFrom)) state.composedMoved = true;
}

/**
 * Whether a field whose composition ended still needs the word handed to it: its component is
 * alive, and its model has not moved at any point since the composition began — asked at every event
 * of it, because a word typed again over itself, or a cancelled one, ends where it began after
 * moving on the way.
 *
 * A handler that takes composing input moved the model — whether it kept the word, changed it
 * (full-width digits to half-width) or cleared the field — and is not called again. Only a model that
 * stands where it stood took nothing, which is the handler that skips composing input. A field whose
 * component the composition's end destroyed — Enter closed the dialog — is handed nothing.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function lacksTheWord(component: Component<any>, state: FieldState): boolean {
  if (component[COMPONENT_RUNTIME].isDestroyed) return false;
  noteMovement(component, state);
  return !state.composedMoved;
}

/**
 * The renders the handler caused, run now, and then the field made to show the model — before any
 * listener after this one reads it, and before the browser draws.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function show(component: Component<any> & { settle(): void }): void {
  drainSync();
  component.settle();
}

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
 * which is what this code has to answer.
 *
 * 4. Type `nihon` again and, before Enter, press Tab to leave the field. Right: the word is kept, or
 *    the field shows the model — never an empty field. Wrong: an empty field, which means Safari sends
 *    `compositionend` after the blur and something wrote the field in between — see "A composition
 *    lost" on `answer`.
 *
 * Delete this note once it is measured.
 */

/**
 * The field's `transform`, its own handler, and then the model — all in the field's own listener.
 *
 * A field with a `value` shows what the model says, and its own handler is what writes the model.
 * So, on every edit and in this order: the edit is decided (`transformAtSource`); the handler the app
 * wrote on the field runs, as a listener would, with the element as `this`; the renders it caused
 * run at once; and the field is made to show the model (`show`). All before any other listener — a
 * form around the field, a library's own — reads the field, and before the browser draws. So every
 * reader reads the same value, and a handler that did not write the model leaves the field showing
 * the model, in the same event. A field with a `value` and no handler of its own shows its model
 * whatever is typed, as in React.
 *
 * **A pick is one edit.** A select sends `input` and then `change` for one pick, both at once. Both
 * of the field's own handlers run on the `input`, so the model is the pick's before a render can land
 * between the two — a form's `oninput` flipping a "Save" button is enough — and the `change` finds
 * nothing left to do.
 *
 * **Not in the middle of a composition.** An input method builds a character over several `input`
 * events, and writing the field between them cancels it: they reach the field's handler, and the
 * field is left alone until the word ends.
 *
 * **When it ends, every browser hands the word over the same way.** The usual handler skips composing
 * input, `if (event.isComposing) return;`, and takes the word from the ordinary `input` that follows.
 * Measured: Firefox sends one — `compositionend`, then `input` with `isComposing: false` and
 * `insertCompositionText`. Chromium does not: its last `input` still says `isComposing`, and nothing
 * follows `compositionend`. So at `compositionend`, while the model lacks the word (`lacksTheWord`),
 * the field's own `oninput` is handed it at once, with that `compositionend`; and Firefox's `input`
 * after it, carrying the same word, does not reach the handler a second time. Every other listener
 * hears what the browser sent.
 *
 * **A composition lost.** A field that loses the focus mid-word may get no `compositionend` at all, or
 * get it after the blur. The blur is noted and the composition goes on, so a render the blur causes —
 * an `onblur` that moves the model — does not write over the word a browser is committing; its
 * `compositionend` hands the word over as any. One that never comes leaves the field as it is until
 * the next ordinary edit, which ends the composition and is answered as any edit.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
export function answer(component: Component<any> & { settle(): void }, event: Event, pick = false): void {
  const state = stateOf(component);
  const field = event.currentTarget as HTMLTextAreaElement | HTMLSelectElement | null;

  if (event.type === "compositionstart") {
    state.composing = true;
    state.blurred = false;
    state.handedOver = undefined;
    state.composedFrom = modelOf(component);
    state.composedMoved = false;
    heard(component, event);
    return;
  }
  if (event.type === "blur") {
    if (state.composing) state.blurred = true;
    heard(component, event);
    return;
  }
  if (event.type === "compositionend") {
    state.composing = false;
    state.blurred = false;
    transformAtSource(component, event);
    try {
      heard(component, event);
      // What the handler took during the composition has been rendered by now, so the model says it.
      drainSync();
      if (field !== null && lacksTheWord(component, state)) {
        state.handedOver = field.value;
        callOwn(component, "input", event);
      }
    } finally {
      show(component);
    }
    return;
  }

  // A composition lost to a blur, with no `compositionend` since, is over once an ordinary edit arrives.
  if (state.blurred && !(event as InputEvent).isComposing) {
    state.composing = false;
    state.blurred = false;
  }
  const composingInput = (event as InputEvent).isComposing || state.composing;
  if (composingInput) {
    try {
      heard(component, event);
    } finally {
      // The render of this input lands before the next event, and tells whether the model moved.
      drainSync();
      noteMovement(component, state);
    }
    return;
  }

  // Firefox's `input` after a composition, with the word the handler was already handed.
  const handed = state.handedOver;
  state.handedOver = undefined;
  if (event.type === "input" && handed !== undefined && field !== null && field.value === handed) {
    return;
  }

  if (pick && event.type === "change" && state.picked) {
    state.picked = false;
    return;
  }

  transformAtSource(component, event);
  try {
    heard(component, event);
    if (pick && event.type === "input") {
      state.picked = true;
      callOwn(component, "change", event);
    }
  } finally {
    show(component);
  }
}
