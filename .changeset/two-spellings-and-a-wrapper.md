---
"@ramonda/check": minor
---

A keyboard path is recognised in both spellings of an event name

`click-with-no-keyboard-path` knew one. The framework takes two — `onclick`, and `on:click` which
hands the name through verbatim for a custom event with a dash or a capital that the first form
cannot reach. `core/Attribute.ts` decides it, and the new `eventTypeOf` mirrors that rather than
inventing an answer.

Measured on a plant: `<div on:click={open}>` was not recognised as a click handler at all, and —
worse — the key handler in `<div onclick={open} on:keydown={onKey}>` was invisible, so an element
whose keyboard path is written on the same line was reported as having none.

`client-only-request-read` had this right and now reads through the same helper, so a fourth rule
cannot drift.
