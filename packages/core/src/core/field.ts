import type { TransformInput } from "../types/commonTypes";
import type { EnhancedHTMLNode } from "../types/vdom";
import { writeValue } from "./Attribute";
import { drainSync } from "./Task";

/** The fields a controlled value can sit on. Told apart by tag name: a field in an iframe is another window's class. */
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** A field's value as `transform` sees it: text, a checkbox's state, or a `multiple` select's choices. */
export type FieldValue = string | boolean | string[];

export type Transform = (next: never, prev: never, input: TransformInput) => unknown;

/**
 * What a controlled field is, to `answerEdit`: where its model is, how its own handlers are called,
 * and how it is made to show the model. A `Select` or a `TextArea` gives one from its component; a
 * plain `<input>` from the element, which the attribute pass keeps its handlers on.
 */
export interface FieldControl {
  /** What the field's state is kept under: the component, or the element. */
  readonly key: object;
  /** A select, a checkbox or a radio: one pick is one edit, `input` then `change`. */
  readonly pick: boolean;
  /** What the model holds now. */
  model(): unknown;
  /** The model as `transform` is given it, as `prev`. */
  prev(): FieldValue;
  transform(): Transform | undefined;
  /** Calls the field's own handler for `type`, if it has one, as a listener would be called. */
  own(type: string, event: Event): void;
  /** Makes the field show the model. */
  settle(): void;
  /** The field's component is gone: a composition's end that destroyed it is handed nothing. */
  gone(): boolean;
}

/** A checkbox or a radio: its value is whether it is checked. */
function isBox(field: Field): field is HTMLInputElement {
  if (field.tagName !== "INPUT") return false;
  const type = (field as HTMLInputElement).type;
  return type === "checkbox" || type === "radio";
}

function isMultiple(field: Field): field is HTMLSelectElement {
  return field.tagName === "SELECT" && (field as HTMLSelectElement).multiple;
}

/** Whether the field has a caret — a text field; `setSelectionRange` throws on a `number` or `date` input. */
function caretOf(field: Field): HTMLInputElement | HTMLTextAreaElement | null {
  if (field.tagName === "SELECT" || isBox(field)) return null;
  const text = field as HTMLInputElement | HTMLTextAreaElement;
  try {
    return text.selectionStart === null ? null : text;
  } catch {
    return null;
  }
}

export function valueOf(field: Field): FieldValue {
  if (isBox(field)) return field.checked;
  if (isMultiple(field)) return Array.from(field.selectedOptions, (option) => option.value);
  return field.value;
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => value === b[i]);
  return a === b;
}

/**
 * The app's `transform(next, prev, input)`, applied to the field before its handler reads it.
 *
 * `next` is what the edit left in the field and `prev` what the model holds; what comes back is what
 * the field keeps — `next` to take the edit, `prev` to refuse it, anything else to rewrite it. It is
 * written at once, in the field's own listener, so the app's handler, a form around the field and
 * anything the event bubbles to all read the same value, and the browser never draws the edit it
 * replaced.
 *
 * A refused edit puts the caret back where the edit found it: the text is the text before the edit,
 * so the offset before the edit means what it meant. A rewrite of the same length keeps the caret
 * through `writeValue`; any other rewrite is the app's to place, as `writeValue` explains.
 *
 * Returns whether it refused the pick of a checkbox or a radio: then nothing was picked, and no
 * handler of the field is called. A radio's `value` is the same whether it is on or off, so a handler
 * that read it would write the refused pick into the model.
 */
export function decideEdit(field: Field, transform: Transform, prev: FieldValue, event: Event): boolean {
  const next = valueOf(field);
  const text = caretOf(field);
  const input: TransformInput = {
    inputType: (event as InputEvent).inputType ?? "",
    selectionStart: text?.selectionStart ?? null,
    selectionEnd: text?.selectionEnd ?? null,
  };
  const kept = transform(next as never, prev as never, input) as FieldValue;
  if (sameValue(kept, next)) return false;

  if (isBox(field)) {
    field.checked = Boolean(kept);
    return Boolean(kept) === prev;
  }
  if (isMultiple(field)) {
    const wanted = new Set((kept as string[]).map(String));
    for (let i = 0; i < field.options.length; i++) field.options[i].selected = wanted.has(field.options[i].value);
    return false;
  }
  if (text === null) {
    field.value = String(kept);
    return false;
  }
  const caret = text.selectionStart;
  writeValue(text as unknown as EnhancedHTMLNode, String(kept), false);
  if (caret !== null && typeof next === "string" && typeof prev === "string" && String(kept) === prev) {
    // What a delete forward took was after the caret, so the caret is where the edit found it; any
    // other edit moved it by what it added or took before it.
    const forward = input.inputType.startsWith("delete") && input.inputType.endsWith("Forward");
    const moved = forward ? 0 : next.length - prev.length;
    const back = Math.max(0, Math.min(prev.length, caret - moved));
    text.setSelectionRange(back, back);
  }
  return false;
}

/** What one controlled field is in the middle of: a composition, or a pick. */
interface FieldState {
  /** An input method is composing in the field right now. */
  composing: boolean;
  /** The field lost the focus in the middle of the composition — see "A composition lost" on `answerEdit`. */
  blurred: boolean;
  /** What the model held when the composition began, and whether it has left it since. */
  composedFrom?: unknown;
  composedMoved: boolean;
  /** The word the field's handler was handed when its composition ended — see "When it ends" on `answerEdit`. */
  handedOver?: string;
  /** A pick was answered on its `input`, so its `change` has nothing left to do. */
  picked: boolean;
}

/** Every controlled field's state, one record each, so no two pieces of it can disagree. */
const fields = new WeakMap<object, FieldState>();

function stateOf(key: object): FieldState {
  let state = fields.get(key);
  if (state === undefined) {
    fields.set(key, (state = { composing: false, blurred: false, composedMoved: false, picked: false }));
  }
  return state;
}

/** A field that stopped being controlled forgets what it was in the middle of. */
export function forgetField(key: object): void {
  fields.delete(key);
}

/**
 * Whether a field leaves its value alone for now: an input method is composing in it. An autosave
 * flipping `disabled` in the middle of a word, and writing the model then, cancels the word being
 * typed. Asked by the field when a render reaches it.
 */
export function composingIn(key: object): boolean {
  return fields.get(key)?.composing === true;
}

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

function noteMovement(control: FieldControl, state: FieldState): void {
  if (!sameModel(control.model(), state.composedFrom)) state.composedMoved = true;
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
function lacksTheWord(control: FieldControl, state: FieldState): boolean {
  if (control.gone()) return false;
  noteMovement(control, state);
  return !state.composedMoved;
}

/**
 * The renders the handler caused, run now, and then the field made to show the model — before any
 * listener after this one reads it, and before the browser draws.
 */
function show(control: FieldControl): void {
  drainSync();
  control.settle();
}

/** Decides the edit; whether it refused a box's pick, which then reaches no handler — see `decideEdit`. */
function decide(control: FieldControl, event: Event): boolean {
  const transform = control.transform();
  const field = event.currentTarget as Field | null;
  return transform !== undefined && field !== null && decideEdit(field, transform, control.prev(), event);
}

/**
 * The field's `transform`, its own handler, and then the model — all in the field's own listener.
 *
 * A field with a `value` (or `checked`) shows what the model says, and its own handler is what
 * writes the model. So, on every edit and in this order: the edit is decided (`decideEdit`); the
 * handler the app wrote on the field runs, as a listener would, with the element as `this`; the
 * renders it caused run at once; and the field is made to show the model (`show`). All before the
 * event bubbles to anything around the field — a form's `oninput`, a library listening on the
 * document — and before the browser draws. So every reader reads the same value, and a handler that
 * did not write the model leaves the field showing the model, in the same event. A field with a
 * `value` and no handler of its own shows its model whatever is typed, as in React.
 *
 * **A pick is one edit.** A select, a checkbox and a radio send `input` and then `change` for one
 * pick, both at once. Both of the field's own handlers run on the `input`, so the model is the pick's
 * before a render can land between the two — a form's `oninput` flipping a "Save" button is enough —
 * and the `change` finds nothing left to do.
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
export function answerEdit(control: FieldControl, event: Event): void {
  const state = stateOf(control.key);
  const field = event.currentTarget as Field | null;

  if (event.type === "compositionstart") {
    state.composing = true;
    state.blurred = false;
    state.handedOver = undefined;
    state.composedFrom = control.model();
    state.composedMoved = false;
    control.own(event.type, event);
    return;
  }
  if (event.type === "blur") {
    if (state.composing) state.blurred = true;
    control.own(event.type, event);
    return;
  }
  if (event.type === "compositionend") {
    state.composing = false;
    state.blurred = false;
    decide(control, event);
    try {
      control.own(event.type, event);
      // What the handler took during the composition has been rendered by now, so the model says it.
      drainSync();
      if (field !== null && lacksTheWord(control, state)) {
        state.handedOver = field.value;
        control.own("input", event);
      }
    } finally {
      show(control);
    }
    return;
  }

  // A composition lost to a blur, with no `compositionend` since, is over once an ordinary edit arrives.
  if (state.blurred && !(event as InputEvent).isComposing) {
    state.composing = false;
    state.blurred = false;
  }
  if ((event as InputEvent).isComposing || state.composing) {
    try {
      control.own(event.type, event);
    } finally {
      // The render of this input lands before the next event, and tells whether the model moved.
      drainSync();
      noteMovement(control, state);
    }
    return;
  }

  // Firefox's `input` after a composition, with the word the handler was already handed.
  const handed = state.handedOver;
  state.handedOver = undefined;
  if (event.type === "input" && handed !== undefined && field !== null && field.value === handed) return;

  if (control.pick && event.type === "change" && state.picked) {
    state.picked = false;
    return;
  }

  if (decide(control, event)) {
    // A refused pick is no pick: its `change`, coming next, finds nothing to do either.
    if (control.pick && event.type === "input") state.picked = true;
    show(control);
    return;
  }
  try {
    control.own(event.type, event);
    if (control.pick && event.type === "input") {
      state.picked = true;
      control.own("change", event);
    }
  } finally {
    show(control);
  }
}

/** Calls a handler as a listener would be: a function with the element as `this`, or `handleEvent`. */
export function callHandler(theirs: unknown, event: Event): void {
  if (typeof theirs === "function") theirs.call(event.currentTarget, event);
  else if (typeof (theirs as EventListenerObject | null)?.handleEvent === "function") {
    (theirs as EventListenerObject).handleEvent(event);
  }
}

/* ------------------------------------------------------------------ *
 * A plain `<input>`, given its handlers and its `transform` by the attribute pass.
 * ------------------------------------------------------------------ */

const OWN = Symbol("ramonda.input.own");
const TRANSFORM = Symbol("ramonda.input.transform");
const CONTROLLED = Symbol("ramonda.input.controlled");
const HEARD = Symbol("ramonda.input.heard");
const CONTROL = Symbol("ramonda.input.control");

type Kept = HTMLInputElement & {
  /** By event type, then by the name the handler was written under — `oninput`, `on:input`. */
  [OWN]?: Record<string, Map<string, unknown>>;
  [TRANSFORM]?: Transform;
  [CONTROLLED]?: boolean;
  /** The event types the field listener is attached for. */
  [HEARD]?: Set<string>;
  [CONTROL]?: FieldControl;
};

/** The events an `<input>`'s own handlers are called on by its field listener, rather than attached. */
export const INPUT_OWN_EVENTS = new Set(["input", "change", "compositionstart", "compositionend", "blur"]);

/**
 * An `<input>`'s own handler for `type`, written as `name`, kept on the element instead of attached to
 * it: the field's listener calls it, so the field knows when it has returned. Each name is a handler
 * of its own, as a listener would be — `oninput` and `on:input` both run. `undefined` takes it away.
 */
export function keepOwnHandler(input: HTMLInputElement, name: string, type: string, handler: unknown): void {
  const kept = input as Kept;
  kept[OWN] ??= {};
  const handlers = (kept[OWN][type] ??= new Map());
  if (handler === undefined) handlers.delete(name);
  else handlers.set(name, handler);
  if (handler !== undefined) listen(kept, [type]);
}

/** Every own handler of `input` for `type`, in the order they were written. */
function callOwn(input: Kept, type: string, event: Event): void {
  const handlers = input[OWN]?.[type];
  if (handlers === undefined) return;
  for (const handler of [...handlers.values()]) callHandler(handler, event);
}

function isRadio(input: HTMLInputElement): boolean {
  return input.type === "radio";
}

/** The radios of `input`'s group: the same `name` in the same form, or in the same root without one. */
function groupOf(input: HTMLInputElement): HTMLInputElement[] {
  if (input.name === "") return [input];
  const root = input.form ?? (input.getRootNode() as ParentNode);
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
    (other) => other.name === input.name && other.form === input.form,
  );
}

/**
 * An `<input>` as `answerEdit` sees it, made once per element. Its model is what the attribute pass
 * wrote as the attribute; the type is read on each call, since a render may change it.
 */
function controlOf(input: Kept): FieldControl {
  const existing = input[CONTROL];
  if (existing !== undefined) return existing;
  const isBoxNow = () => input.type === "checkbox" || isRadio(input);
  const model = () => (isBoxNow() ? input.hasAttribute("checked") : (input.getAttribute("value") ?? ""));
  const control: FieldControl = {
    key: input,
    get pick() {
      return isBoxNow();
    },
    model,
    prev: model,
    transform: () => input[TRANSFORM],
    own: (type, event) => callOwn(input, type, event),
    settle: () => {
      const box = isBoxNow();
      if (composingIn(input)) return;
      if (isRadio(input)) {
        // Clicking one radio unchecks another, which hears nothing: the whole group is put back.
        for (const radio of groupOf(input)) {
          const on = radio.hasAttribute("checked");
          if (radio.checked !== on) radio.checked = on;
        }
      } else if (box) {
        const on = input.hasAttribute("checked");
        if (input.checked !== on) input.checked = on;
      } else {
        const model = input.getAttribute("value") ?? "";
        if (input.value !== model) writeValue(input as unknown as EnhancedHTMLNode, model, false);
      }
    },
    gone: () => false,
  };
  input[CONTROL] = control;
  return control;
}

/**
 * The one listener an `<input>` answers its own events with, attached once, in the CAPTURE phase on
 * the element: at its target an event reaches capture listeners before the others, so the field is
 * answered before any other listener on it, and before the event bubbles to anything around it. A
 * capture listener on an ancestor runs first, as the DOM orders capture, and sees the edit undecided.
 * An uncontrolled input's
 * handlers are simply called; a controlled one's go through `answerEdit`.
 */
function heardByInput(event: Event): void {
  const input = event.currentTarget as Kept;
  if (input[CONTROLLED]) answerEdit(controlOf(input), event);
  else callOwn(input, event.type, event);
}

/**
 * Attaches the field listener for `types`, each once. An uncontrolled input is heard for the events it
 * has a handler for; a controlled one for all of `INPUT_OWN_EVENTS`, which its field answers.
 */
function listen(input: Kept, types: Iterable<string>): void {
  const heard = (input[HEARD] ??= new Set());
  for (const type of types) {
    if (heard.has(type)) continue;
    heard.add(type);
    input.addEventListener(type, heardByInput, true);
  }
}

/**
 * After an `<input>`'s attribute pass: whether it is controlled — a `value`, or a `checked` that is
 * `true` or `false` — and its `transform`, which a controlled field alone takes.
 */
export function controlInput(input: HTMLInputElement, attributes: Record<string, unknown>): void {
  const kept = input as Kept;
  const box = input.type === "checkbox" || isRadio(input);
  const controlled = box ? typeof attributes.checked === "boolean" : attributes.value != null;
  if (!controlled && kept[CONTROLLED]) forgetField(input);
  kept[CONTROLLED] = controlled;
  const transform = attributes.transform;
  kept[TRANSFORM] = controlled && typeof transform === "function" ? (transform as Transform) : undefined;
  if (controlled) listen(kept, INPUT_OWN_EVENTS);
}
