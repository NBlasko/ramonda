import ts from "typescript";

/**
 * The DOM event a JSX attribute name listens for.
 *
 * Two spellings, and they are the framework's own — mirrored from `eventTypeOf` in
 * `core/Attribute.ts` rather than invented here, because a checker that disagrees with the runtime
 * about which attribute is a listener is wrong however reasonable its own answer looks.
 *
 * - `onclick` — the DOM's own name with `on` in front, lowercased. Exact, because every event type
 *   in the DOM's element maps is already all-lowercase, so lowercasing can never corrupt one.
 * - `on:my-event` — the rest handed through UNTOUCHED, for a name the first form cannot reach: a
 *   custom event with a dash or a capital in it. `<x-thing on:my-event={…} />` listens for
 *   `my-event`.
 *
 * Shared because three rules read this question and one of them had only ever seen the first
 * spelling: measured on a plant, `<div on:click={open}>` was not recognised as a click handler at
 * all, and `<div onclick={open} on:keydown={onKey}>` was REPORTED as having no keyboard path while
 * the handler that gives it one was written on the same line.
 */
export function eventTypeOf(name: string): { type: string; verbatim: boolean } | undefined {
  if (name.startsWith("on:")) return name.length > 3 ? { type: name.slice(3), verbatim: true } : undefined;
  if (!name.startsWith("on") || name.length <= 2) return undefined;
  return { type: name.slice(2).toLowerCase(), verbatim: false };
}

/**
 * The handlers a pointer alone can deliver. `onmousedown` and `ondblclick` are the same fault.
 *
 * By EVENT TYPE rather than by attribute name, so both spellings land on one entry. `ondblclick`,
 * not `ondoubleclick`: the DOM event is `dblclick`, so the longer name matched nothing and was a
 * set entry that had never been able to fire.
 */
const POINTER_ONLY: ReadonlySet<string> = new Set(["click", "mousedown", "mouseup", "dblclick"]);

/**
 * The pointer-only handler written on this element, if there is one.
 *
 * Shared by the two rules that ask "was the mouse wired up here" — one about an element with no
 * keyboard path at all, one about a path somebody started building by hand and did not finish.
 * They enter on the same condition and must agree about what a click is.
 */
export function pointerHandlerOn(opening: ts.JsxOpeningLikeElement): string | undefined {
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText();
    if (POINTER_ONLY.has(eventTypeOf(name)?.type ?? "")) return name;
  }
  return undefined;
}

/**
 * Whether any keyboard handler is written at all. Which one is not either caller's business.
 *
 * Through `eventTypeOf`, because the framework takes TWO spellings and this knew one. A regex on
 * the written name missed `on:keydown` — measured, and the cost was the worst kind: an element with
 * a keyboard handler written on the same line was reported as having no keyboard path.
 */
export function hasAKeyHandler(opening: ts.JsxOpeningLikeElement): boolean {
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (eventTypeOf(attribute.name.getText())?.type.startsWith("key") === true) return true;
  }
  return false;
}
