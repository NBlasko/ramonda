/**
 * The HTML boolean attributes, as the spec defines them: present means true.
 *
 * A boolean attribute carries no value — the parser reads only whether it is there. Writing one as
 * `disabled="true"` still means disabled, because the value is ignored, but it is not what HTML
 * says and it puts a word in the markup that nothing reads. The empty string is the spelling the
 * spec gives, and the one a browser writes back if you ask it.
 *
 * `aria-*` is deliberately absent. ARIA attributes are enumerated STRINGS, not boolean attributes:
 * `aria-hidden="false"` is valid and means "not hidden", and `aria-hidden=""` would be neither.
 * `data-*` is absent for the same reason — its value is data, and an empty one is not the same as
 * `"true"` to whatever reads it back.
 */
export const BOOLEAN_ATTRIBUTES = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);
