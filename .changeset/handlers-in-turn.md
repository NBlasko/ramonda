---
"@ramonda/core": minor
---

A field's own handler that stops the event stops the field's other handlers for it

An `<input>`, a `TextArea` and a `Select` call their own handlers themselves — `oninput`, then
`on:input` — so the field knows when they have returned. One that called `stopImmediatePropagation()`
did not stop the next, as it would stop the next listener on the element. It does now, for the event and
for the `input` a finished word is handed over as. And one an earlier one takes away — a render it settled
dropped it — is not called, as a listener removed mid-dispatch is not.
