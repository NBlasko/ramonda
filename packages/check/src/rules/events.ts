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
