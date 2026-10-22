import { UNEDITED_INPUT_TYPES } from "@ramonda/dom-facts";
import type { TransformInput } from "../types/commonTypes";
import type { EnhancedHTMLNode } from "../types/vdom";
import { writeValue } from "./Attribute";
import { drainSync, drainingNow } from "./Task";

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
 * Returns whether it REFUSED the edit — the edit changed the field and the answer is `prev`. A refused
 * edit is no edit: the field's `oninput` and `onchange` are not called, for any field. One rule, so a
 * handler never has to tell a refused edit from a real one — a radio's `value` is the same on or off,
 * and a handler that read it would write the refused pick into the model.
 */
export function decideEdit(
  field: Field,
  transform: Transform,
  prev: FieldValue,
  event: Event,
  before?: Selected,
): boolean {
  // A `multiple` select is decided as a list, a model of one value included — as the element says.
  if (isMultiple(field) && !Array.isArray(prev)) prev = [String(prev)];
  const next = valueOf(field);
  const text = caretOf(field);
  const input: TransformInput = {
    // The word an input method commits is decided at `compositionend`, as the edit it is.
    inputType: event.type === "compositionend" ? "insertCompositionText" : ((event as InputEvent).inputType ?? ""),
    selectionStart: text?.selectionStart ?? null,
    selectionEnd: text?.selectionEnd ?? null,
  };
  // A transform that answers nothing — a path with no `return`, past the types — refuses the edit,
  // rather than writing the text "undefined" into the field and the model.
  const kept = (transform(next as never, prev as never, input) ?? prev) as FieldValue;
  if (sameValue(kept, next)) return false;
  // As the model is compared: a multiple select's answer in another order is the same choice.
  const refused = sameModel(kept, prev);

  if (isBox(field)) {
    field.checked = Boolean(kept);
    return refused;
  }
  if (isMultiple(field)) {
    const wanted = new Set((kept as string[]).map(String));
    for (let i = 0; i < field.options.length; i++) field.options[i].selected = wanted.has(field.options[i].value);
    return refused;
  }
  if (text === null) {
    field.value = String(kept);
    return refused;
  }
  const caret = text.selectionStart;
  writeValue(text as unknown as EnhancedHTMLNode, String(kept), false);
  if (caret !== null && typeof next === "string" && typeof prev === "string" && String(kept) === prev) {
    // The selection the edit found, as `beforeinput` saw it — the one exact record of it — when the
    // field showed the model then: a paste over `hello` selected is `hello` selected again.
    if (before !== undefined && before.text === prev && before.start !== null && before.end !== null) {
      text.setSelectionRange(before.start, before.end);
      return refused;
    }
    // What a delete forward took was after the caret, so the caret is where the edit found it; any
    // other edit moved it by what it added or took before it.
    const forward = input.inputType.startsWith("delete") && input.inputType.endsWith("Forward");
    const moved = forward ? 0 : next.length - prev.length;
    const back = Math.max(0, Math.min(prev.length, caret - moved));
    text.setSelectionRange(back, back);
  }
  return refused;
}

/** A text field as `beforeinput` found it: its text and its selection, the moment before an edit. */
interface Selected {
  text: string;
  start: number | null;
  end: number | null;
  /** The `beforeinput` itself: a cancelled one was not followed by its edit. */
  event: InputEvent;
}

/** What one controlled field is in the middle of: a composition, or a pick. */
interface FieldState {
  /** An input method is composing in the field right now. */
  composing: boolean;
  /** The field lost the focus in the middle of the composition — see "A composition lost" on `answerEdit`. */
  blurred: boolean;
  /** What the model held when the composition began: a model the app moves in the middle of a word wins. */
  composedFrom?: unknown;
  /** The blur's own listener is running: what it renders leaves a word the browser may still commit. */
  inBlur?: boolean;
  /**
   * What the field held when its composition ended — the word its handler was handed, or what a
   * refusal left — so Firefox's `input` after it reaches no handler. See "When it ends" on `answerEdit`.
   */
  handedOver?: string;
  /** A pick was answered on its `input`, so its `change` has nothing left to do. */
  picked: boolean;
  /** The text and the selection the next edit starts from, recorded at its `beforeinput`. */
  before?: Selected;
  /** What the field's `onchange`, called on the pick's `input`, asked of the `change` it was told it had. */
  pickAsked?: Asked;
}

/** Every controlled field's state, one record each, so no two pieces of it can disagree. */
const fields = new WeakMap<object, FieldState>();

function stateOf(key: object): FieldState {
  let state = fields.get(key);
  if (state === undefined) {
    fields.set(key, (state = { composing: false, blurred: false, picked: false }));
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
  const state = fields.get(key);
  // A word lost to a blur holds the field only while the blur's own listener runs: past it, a model
  // the app moves — a Clear button, a reset — is shown, even if no `compositionend` ever comes.
  return state?.composing === true && (!state.blurred || state.inBlur === true);
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

/**
 * The renders an event caused, run now — unless rendering work is already running (an event fired
 * from a `@mounted`, a field a reconcile removes), which runs them itself before it returns.
 */
function runRenders(): void {
  if (!drainingNow()) drainSync();
}

/**
 * The renders the handler caused, run now, and then the field made to show the model — before any
 * listener after this one reads it, and before the browser draws.
 *
 * Inside running rendering work the handler's renders have not happened yet, so settling now would
 * show the model as it was: the field is settled in a microtask instead, once that work has returned
 * and the renders it queued have run — still before the browser draws. `after` runs after the settle.
 */
function show(control: FieldControl, after?: () => void): void {
  if (drainingNow()) {
    // Once the running work has returned — the renders the handler queued run in a pass after it,
    // so settling at the end of this commit would still show the model as it was. A microtask is
    // still before the browser draws.
    queueMicrotask(() => {
      if (!drainingNow()) drainSync();
      control.settle();
      after?.();
    });
    return;
  }
  drainSync();
  control.settle();
  after?.();
}

/**
 * `decide`, and when the app's `transform` throws, the field shows the model before the error goes on:
 * no handler ran, so the model is where it was, and the field must not keep an edit it never took.
 */
function decideOrShow(control: FieldControl, event: Event): boolean {
  try {
    return decide(control, event);
  } catch (error) {
    // A pick whose `input` threw is over: its `change`, coming next, is not a pick of its own.
    try {
      control.settle();
    } catch {
      // The transform's error is the cause.
    }
    throw error;
  }
}

/** Decides the edit; whether it refused it, which then reaches no handler of the field — see `decideEdit`. */
function decide(control: FieldControl, event: Event): boolean {
  const transform = control.transform();
  const field = event.currentTarget as Field | null;
  const state = stateOf(control.key);
  // The record belongs to this edit only when its `beforeinput` went ahead and announced this kind of
  // edit: a cancelled keystroke, then an autofill with no `beforeinput` of its own, is not that edit.
  const recorded = state.before;
  state.before = undefined;
  const before =
    recorded !== undefined &&
    !recorded.event.defaultPrevented &&
    recorded.event.inputType === ((event as InputEvent).inputType ?? "")
      ? recorded
      : undefined;
  return transform !== undefined && field !== null && decideEdit(field, transform, control.prev(), event, before);
}

/**
 * The field's `transform`, its own handler, and then the model — all in the field's own listener.
 *
 * A field with a `value` (or `checked`) shows what the model says, and its own handler is what
 * writes the model. So, on every edit and in this order: the edit is decided (`decideEdit`), and an
 * edit it refused ends there, with the field showing the model; the handler the app wrote on the
 * field runs, as a listener would, with the element as `this`; the
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
 * **Not in the middle of a composition.** An input method builds a word over several `input` events,
 * and writing the field between them cancels it. They reach no handler of the field — the
 * `transform` cannot decide a word that is not finished, and a handler that took the unfinished one
 * would write past it — and the field is left alone until the word ends.
 *
 * **When it ends, the word is one edit, and every browser hands it over the same way.** It is decided
 * by the `transform` against the model as it stood before the word, and a word the transform keeps
 * reaches the field's `oninput` once, at `compositionend` — so a handler never has to ask
 * `isComposing`. Measured: Firefox then sends an `input` of its own, `insertCompositionText` with the
 * same word, which reaches no handler a second time; Chromium sends nothing after `compositionend`.
 * A field the end of the word removed — Enter closed its dialog — is handed nothing, and so is one
 * whose model the app moved in the middle of the word — a chat that sent and cleared it: the app's
 * write wins, and the field shows it. Every other listener hears what the browser sent.
 *
 * **A composition lost.** A field that loses the focus mid-word may get no `compositionend` at all, or
 * get it after the blur. The blur is noted, and what its own listener renders — an `onblur` that moves
 * the model — does not write over the word a browser may still commit; its `compositionend` hands the
 * word over as any. Past the blur the field follows the model again, so a model the app moves after
 * it — a Clear button, a reset — is shown even when no `compositionend` ever comes. The composition
 * itself ends with its `compositionend` or the next ordinary edit, answered as any edit.
 */
export function answerEdit(control: FieldControl, event: Event): void {
  // A field the tree took away answers nothing — a browser blurs a focused field as it is removed.
  if (control.gone()) return;
  const state = stateOf(control.key);
  // The selection `beforeinput` recorded belongs to the `input` right after it; anything else in
  // between — a cancelled edit sends none — and it is no longer the edit's.
  if (event.type !== "beforeinput" && event.type !== "input") state.before = undefined;
  // A pick's `change` follows its `input` at once; any other event in between means it is not coming —
  // an `input` dispatched alone — so a later, unrelated `change` is answered as its own.
  if (control.pick && event.type !== "change") {
    state.picked = false;
    state.pickAsked = undefined;
  }
  const field = event.currentTarget as Field | null;

  // The moment before an edit, the one time the field's selection is still the user's: kept for a
  // refusal to put back.
  if (event.type === "beforeinput") {
    const text = field === null ? null : caretOf(field);
    state.before =
      text === null
        ? undefined
        : { text: text.value, start: text.selectionStart, end: text.selectionEnd, event: event as InputEvent };
    control.own(event.type, event);
    return;
  }
  if (event.type === "compositionstart") {
    state.composing = true;
    state.blurred = false;
    state.handedOver = undefined;
    state.composedFrom = control.model();
    control.own(event.type, event);
    return;
  }
  if (event.type === "blur") {
    if (state.composing) state.blurred = true;
    // The blur's own renders leave the word alone; after it, the field follows the model again — see
    // `composingIn` and "A composition lost".
    state.inBlur = true;
    try {
      control.own(event.type, event);
      runRenders();
    } finally {
      state.inBlur = false;
    }
    return;
  }
  if (event.type === "compositionend") {
    state.composing = false;
    state.blurred = false;
    const refused = decideOrShow(control, event);
    answered(
      control,
      () => {
        control.own(event.type, event);
        // What `oncompositionend` rendered has run by now: it may have removed the field.
        runRenders();
        // A word the transform refused is no word: it is not handed over, and Firefox's `input` after
        // it, carrying the field as the refusal left it, reaches no handler either.
        if (!refused && field !== null && !control.gone() && sameModel(control.model(), state.composedFrom)) {
          // An `input`, as `oninput` is promised: the word, one edit, `insertCompositionText`.
          control.own("input", as(event, "input", { inputType: "insertCompositionText", isComposing: false }));
        }
      },
      // What the field shows once the composition is over and it is settled — the handler's word, a
      // refusal, or a model the app moved: Firefox's `input` carries exactly that, and reaches no
      // handler, however it ended; recorded after the settle, even one a running commit holds back.
      () => {
        if (field !== null) state.handedOver = field.value;
      },
    );
    return;
  }

  // A composition lost to a blur, with no `compositionend` since, is over once an ordinary edit arrives.
  if (state.blurred && !(event as InputEvent).isComposing) {
    state.composing = false;
    state.blurred = false;
  }
  // The unfinished word reaches no handler of the field: it is handed over, decided, when it ends.
  if ((event as InputEvent).isComposing || state.composing) return;

  // Firefox's `input` after a composition, with the word the handler was handed or what a refusal left.
  // Only Firefox sends it, as `insertCompositionText`; Chromium sends nothing, so whatever comes next
  // clears the slot, and a real edit that leaves the same text is never taken for it.
  const handed = state.handedOver;
  state.handedOver = undefined;
  if (
    event.type === "input" &&
    (event as InputEvent).inputType === "insertCompositionText" &&
    handed !== undefined &&
    field !== null &&
    field.value === handed
  ) {
    return;
  }

  if (control.pick && event.type === "change" && state.picked) {
    state.picked = false;
    // What `onchange` asked of the `change` it was handed on the pick's `input` is done to this one.
    const asked = state.pickAsked;
    state.pickAsked = undefined;
    if (asked?.immediate) event.stopImmediatePropagation();
    else if (asked?.propagation) event.stopPropagation();
    if (asked?.prevented) event.preventDefault();
    return;
  }

  // A text field's `change` that follows an `input` the field already answered — on blur, or after a
  // date's or a range's `input` — is no edit: the field shows the model, its `onchange` runs, and
  // nothing is decided again, as a TextArea leaves its `change` alone. One that brings a value no
  // `input` carried — an autofill, a change dispatched alone — is an edit, and is decided as one.
  if (!control.pick && event.type === "change" && field !== null && showsTheModel(field, control.model())) {
    answered(control, () => control.own("change", event));
    return;
  }
  // A pick is one move from its `input` on, whatever happens to it — refused, or a transform or a
  // handler that throws: the `change` after it finds the pick answered. Marked once, before anything
  // can leave this function.
  if (control.pick && event.type === "input") state.picked = true;
  if (decideOrShow(control, event)) {
    show(control);
    return;
  }
  answered(control, () => {
    control.own(event.type, event);
    if (control.pick && event.type === "input") {
      // A `change`, as `onchange` is promised; what it stops or prevents is done to the real one.
      const asked: Asked = { propagation: false, immediate: false, prevented: false };
      state.pickAsked = asked;
      control.own("change", as(event, "change", {}, asked));
    }
  });
}

/**
 * An error reported as the platform reports an uncaught one: `reportError` where there is one — an
 * `error` event on the window, then the console unless a listener took it — and the same by hand
 * where there is not.
 */
function reportUncaught(error: unknown): void {
  if (typeof reportError === "function") {
    reportError(error);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const unheard =
    typeof window === "undefined" ||
    typeof ErrorEvent === "undefined" ||
    window.dispatchEvent(new ErrorEvent("error", { error, message, cancelable: true }));
  if (unheard) console.error(error);
}

/**
 * The app's handlers, then the field shown the model — and when a handler threw, its error is the one
 * the app sees: the render of the state it half wrote may throw as well, and must not take its place.
 */
function answered(control: FieldControl, handlers: () => void, after?: () => void): void {
  let thrown: { error: unknown } | undefined;
  try {
    handlers();
  } catch (error) {
    thrown = { error };
  }
  if (thrown === undefined) {
    show(control, after);
    return;
  }
  try {
    show(control, after);
  } catch (renderError) {
    // The handler's error is the one thrown here; the render's is reported as an uncaught error is,
    // and the field still shows the model.
    reportUncaught(renderError);
    try {
      control.settle();
      after?.();
    } catch {
      // Already reported.
    }
  }
  throw thrown.error;
}

/**
 * Whether the field already shows the model. A number field shows the same NUMBER in more than one
 * text — `1.50` is the model's 1.5 while the user types toward `1.505` — and rewriting it would take
 * the half-typed text away; every other field shows the model only as its exact text.
 */
export function showsTheModel(field: { type?: string; value: string }, model: unknown): boolean {
  const text = String(model ?? "");
  if (field.value === text) return true;
  if (field.type !== "number" || field.value === "" || text === "") return false;
  return Number(field.value) === Number(text);
}

/** What a handler asked of an event it was handed as another: to stop it, or to prevent its default. */
interface Asked {
  propagation: boolean;
  immediate: boolean;
  prevented: boolean;
}

/**
 * `event` as a handler of the field is promised it: `oninput` an `input`, `onchange` a `change` —
 * when the field answers the edit on another event (a pick on its `input`, a word on its
 * `compositionend`). Everything else is the event itself, `currentTarget` included. What the handler
 * stops or prevents — by method, or by `cancelBubble` and `returnValue` — is recorded in `asked`, for
 * the event it was told about; without `asked` it reaches the event itself. It is a view, not an
 * event: dispatching it again is the one thing it cannot do.
 */
function as(event: Event, type: string, own: Record<string, unknown>, asked?: Asked): Event {
  return new Proxy(event, {
    get(target, key) {
      if (key === "type") return type;
      if (typeof key === "string" && Object.hasOwn(own, key)) return own[key];
      if (asked !== undefined) {
        if (key === "stopPropagation") return () => void (asked.propagation = true);
        if (key === "stopImmediatePropagation") return () => void (asked.immediate = true);
        if (key === "preventDefault") return () => void (asked.prevented = true);
        if (key === "defaultPrevented") return asked.prevented;
        if (key === "cancelBubble") return asked.propagation || asked.immediate;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    // The old spellings of the same three asks, `cancelBubble = true` and `returnValue = false`.
    set(target, key, value) {
      if (asked !== undefined && key === "cancelBubble") {
        if (value === true) asked.propagation = true;
        return true;
      }
      if (asked !== undefined && key === "returnValue") {
        if (value === false) asked.prevented = true;
        return true;
      }
      return Reflect.set(target, key, value, target);
    },
  });
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
const GONE = Symbol("ramonda.input.gone");

type Kept = HTMLInputElement & {
  /** By event type, then by the name the handler was written under — `oninput`, `on:input`. */
  [OWN]?: Record<string, Map<string, unknown>>;
  [TRANSFORM]?: Transform;
  [CONTROLLED]?: boolean;
  /** The event types the field listener is attached for. */
  [HEARD]?: Set<string>;
  [CONTROL]?: FieldControl;
  [GONE]?: true;
};

/**
 * The tree took this `<input>` away. A composition whose end removed it — Enter closing the dialog
 * it was in — hands its word to nobody, as a `Select` or `TextArea` whose component was destroyed.
 */
export function inputRemoved(input: HTMLInputElement): void {
  (input as Kept)[GONE] = true;
  forgetField(input);
}

/** The events an `<input>`'s own handlers are called on by its field listener, rather than attached. */
export const INPUT_OWN_EVENTS = new Set([
  "beforeinput",
  "input",
  "change",
  "compositionstart",
  "compositionend",
  "blur",
]);

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

/**
 * The radios of `input`'s group: the same `name` in the same form — its `elements`, which hold a radio
 * tied to it by `form="id"` from outside the element too — or in the same root without one.
 */
function groupOf(input: HTMLInputElement): HTMLInputElement[] {
  if (input.name === "") return [input];
  // Without a form, only the radios, rather than every input on the page — and the name compared here,
  // so a name no selector can hold (a line break, from data) is a name like any other.
  const candidates = input.form
    ? Array.from(input.form.elements)
    : Array.from((input.getRootNode() as ParentNode).querySelectorAll('input[type="radio"]'));
  // By tag, not `instanceof`: a field in an iframe is another window's `HTMLInputElement`.
  return (candidates as HTMLInputElement[]).filter(
    (other) =>
      other.tagName === "INPUT" && other.type === "radio" && other.name === input.name && other.form === input.form,
  );
}

/**
 * An `<input>` as `answerEdit` sees it, made once per element. Its model is what the attribute pass
 * wrote as the attribute; the type is read on each call, since a render may change it.
 */
function controlOf(input: Kept): FieldControl {
  const existing = input[CONTROL];
  if (existing !== undefined) return existing;
  const isBoxNow = () => isBox(input);
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
        if (!showsTheModel(input, model)) writeValue(input as unknown as EnhancedHTMLNode, model, false);
      }
    },
    gone: () => input[GONE] === true,
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
  const box = isBox(input);
  // A file, a button, a hidden value: no one edits its `value`, so it holds no model to show.
  const controlled =
    !UNEDITED_INPUT_TYPES.has(input.type) && (box ? typeof attributes.checked === "boolean" : attributes.value != null);
  if (!controlled && kept[CONTROLLED]) forgetField(input);
  kept[CONTROLLED] = controlled;
  const transform = attributes.transform;
  kept[TRANSFORM] = controlled && typeof transform === "function" ? (transform as Transform) : undefined;
  if (controlled) listen(kept, INPUT_OWN_EVENTS);
}
