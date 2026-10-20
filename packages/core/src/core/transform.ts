import type { TransformInput } from "../types/commonTypes";
import type { EnhancedHTMLNode } from "../types/vdom";
import { writeValue } from "./Attribute";

const TRANSFORM = Symbol("ramonda.transform");
const HEARD = Symbol("ramonda.transform.heard");
type Decided = HTMLInputElement & {
  [TRANSFORM]?: (next: never, prev: never, input: TransformInput) => unknown;
  [HEARD]?: true;
};

/** Inputs in the middle of a composition: nothing is written to one until its word ends. */
const composing = new WeakSet<HTMLInputElement>();

/**
 * `transform` on an `<input>`, given by the attribute pass.
 *
 * Kept on the element and read by a listener attached once, in the CAPTURE phase on the element
 * itself: at its target an event reaches capture listeners before the others, so the decision comes
 * before the app's `oninput` whichever order the attributes were written in. The model is what the
 * `value` attribute says — which the attribute pass keeps as the model's, the property being the
 * field's — and for a checkbox, whether `checked` is there.
 */
export function transformInput(input: HTMLInputElement, transform: unknown): void {
  const field = input as Decided;
  field[TRANSFORM] = typeof transform === "function" ? (transform as Decided[typeof TRANSFORM]) : undefined;
  if (field[HEARD] || field[TRANSFORM] === undefined) return;
  field[HEARD] = true;
  for (const type of ["input", "change", "compositionstart", "compositionend"]) {
    field.addEventListener(type, decideInput, true);
  }
}

function decideInput(event: Event): void {
  const field = event.currentTarget as Decided;
  const transform = field[TRANSFORM];
  if (transform === undefined) return;
  if (event.type === "compositionstart") {
    composing.add(field);
    return;
  }
  if (event.type === "compositionend") composing.delete(field);
  else if ((event as InputEvent).isComposing || composing.has(field)) return;
  const prev = field.type === "checkbox" ? field.hasAttribute("checked") : (field.getAttribute("value") ?? "");
  decideEdit(field, transform, prev, event);
}

/** A field's value as `transform` sees it: text, a checkbox's state, or a `multiple` select's choices. */
export type FieldValue = string | boolean | string[];

/** The fields a `transform` can sit on. Told apart by tag name: a field in an iframe is another window's class. */
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isCheckbox(field: Field): field is HTMLInputElement {
  return field.tagName === "INPUT" && (field as HTMLInputElement).type === "checkbox";
}

function isMultiple(field: Field): field is HTMLSelectElement {
  return field.tagName === "SELECT" && (field as HTMLSelectElement).multiple;
}

/** Whether the field has a caret — a text field; `setSelectionRange` throws on a `number` or `date` input. */
function caretOf(field: Field): HTMLInputElement | HTMLTextAreaElement | null {
  if (field.tagName === "SELECT" || isCheckbox(field)) return null;
  const text = field as HTMLInputElement | HTMLTextAreaElement;
  try {
    return text.selectionStart === null ? null : text;
  } catch {
    return null;
  }
}

export function valueOf(field: Field): FieldValue {
  if (isCheckbox(field)) return field.checked;
  if (isMultiple(field)) return Array.from(field.selectedOptions, (option) => option.value);
  return field.value;
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => value === b[i]);
  return a === b;
}

/**
 * The app's `transform(next, prev, input)`, applied to the field before any listener reads it.
 *
 * `next` is what the edit left in the field and `prev` what the model holds; what comes back is what
 * the field keeps — `next` to take the edit, `prev` to refuse it, anything else to rewrite it. It is
 * written at once, in the field's own listener, so the app's handler, a form around the field and any
 * other listener all read the same value, and the browser never draws the edit it replaced.
 *
 * A refused edit puts the caret back where the edit found it: the text is the text before the edit,
 * so the offset before the edit means what it meant. A rewrite of the same length keeps the caret
 * through `writeValue`; any other rewrite is the app's to place, as `writeValue` explains.
 */
export function decideEdit(
  field: Field,
  transform: (next: never, prev: never, input: TransformInput) => unknown,
  prev: FieldValue,
  event: Event,
): void {
  const next = valueOf(field);
  const text = caretOf(field);
  const input: TransformInput = {
    inputType: (event as InputEvent).inputType ?? "",
    selectionStart: text?.selectionStart ?? null,
    selectionEnd: text?.selectionEnd ?? null,
  };
  const kept = transform(next as never, prev as never, input) as FieldValue;
  if (sameValue(kept, next)) return;

  if (isCheckbox(field)) {
    field.checked = Boolean(kept);
    return;
  }
  if (isMultiple(field)) {
    const wanted = new Set((kept as string[]).map(String));
    for (let i = 0; i < field.options.length; i++) field.options[i].selected = wanted.has(field.options[i].value);
    return;
  }
  if (text === null) {
    field.value = String(kept);
    return;
  }
  const caret = text.selectionStart;
  writeValue(text as unknown as EnhancedHTMLNode, String(kept), false);
  if (caret !== null && typeof next === "string" && typeof prev === "string" && String(kept) === prev) {
    const back = Math.max(0, Math.min(prev.length, caret - (next.length - prev.length)));
    text.setSelectionRange(back, back);
  }
}
