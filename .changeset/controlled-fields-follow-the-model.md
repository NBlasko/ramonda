---
"@ramonda/core": minor
---

A controlled `Select` or `TextArea` shows the model's value again once the event its handler answers is over

After an event the app wrote a handler for — `onchange` or `oninput` — `Select` and `TextArea` call
it and then render again, so the field shows whatever the model now holds. A handler that leaves the
value where it was — a refused pick, a rejected keystroke — puts it back. Before, the field kept
showing the user's input until the page rendered again for another reason: a `Select` was put right
by its parent's next render, which handed it new children every time, and a `TextArea` never was.

Only the events the app handles are answered, and only once the whole event is over: a select fires
`input` before `change`, and answering the first put the old value back before an `onchange` could
read the pick; a listener on an ancestor reads what the user typed. A handler that throws still has
the value put back. A field with no handler behaves as before — it shows what the user put in. The
handler is called as a listener is, with the element as `this`.
