---
"@ramonda/check": minor
---

Four more element readers follow a name to its declaration, which closes two false reports and two
project-wide silences.

`attr` and `numberAttr` already did this — `role={ROLE}` where `const ROLE = "button"` is the same
fact as `role="button"`. Every reader beside them was still literal-only, and none of it is visible
from a rule's own source: each of these rules calls a helper whose name says it reads the attribute.
Measured by planting the same shape into all of them.

**Two rules were reporting correct markup.**

- `heading-skips-a-level` read a `role` literally, so `<h3 role={PRESENTATION}>` — which is not in
  the outline at runtime — was reported as skipping a level. The same blindness missed
  `<div role={HEADING} aria-level={6}>`, which is a real skip. `stringAttr` now follows a name, and
  takes a `resolve` rather than defaulting one.
- `control-with-no-label` reported `<input type={IMAGE_TYPE} />` as an unlabelled control. An image
  input is named by its `alt` and is `unnamed-image`'s subject, where it was already reported.

**Two silences that scaled with the project.** The id table read only literals, so a project that
keeps its ids in one module — the ordinary way to make two references agree — marked every one of
them unreadable, and one unreadable id anywhere silences
`reference-to-an-id-that-is-not-there` for the whole project. Measured: a mistyped `aria-labelledby`
and a fragment link to nowhere, both reported by nothing. The same fault in two more spellings:
`@Host("section", () => ({ id: OVERVIEW_ID }))`, and `({ id })`, which was read by nothing at all.

Also: `trueAttr` follows a name, so `aria-hidden={HIDDEN}` is the fourth spelling of a fact whose
other three were already read — `aria-hidden-on-focusable` and `empty-heading-or-link` both went
quiet one hop away. `aria-level="6"` is read as a number where it is written, and now through a name
holding `"6"` as well.

No change to what is reported on any project in this repository — `apps/docs`, the three
playgrounds, `router`, `query` and `form` produce byte-identical output before and after.
