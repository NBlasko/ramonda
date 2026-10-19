---
"@ramonda/core": minor
---

`Select` and `TextArea` take `value` for a field the model holds, and `defaultValue` for one the user owns

With `value`, the field shows what the model holds after every input: once the event is over it is
settled from the model, so a handler that takes the input leaves the field as the user made it and
one that does not — or no handler at all — puts the model's value back. Before, the field kept
showing the user's input until the page rendered again for another reason: a `Select` was put right
by its parent's next render, which handed it new children every time, and a `TextArea` never was.

With `defaultValue`, the field shows it first and then belongs to the user — for a form whose fields
are read when it is sent. A `TextArea`'s text follows `defaultValue` until the user edits it, so one
that arrives from a load fills a field nobody has typed in; on a served page the field shows it before
any script runs. A handler may be a function or a listener object, as for any element.

The settle waits for the whole event, so an `onchange` reads the user's pick and a listener on an
ancestor reads what was typed — or moves the model itself; it leaves an input method's composition
alone while it lasts — a render in the middle of one, say an autosave flipping `disabled`, does not
write the model into the field — and settles the field when it ends. One whose field is blurred with
no `compositionend` by the end of that event is over: the field shows the model again, and follows it
as any field does; a browser that commits the word on blur, sending `compositionend` just after,
keeps the word. A render in the middle of an event leaves the field alone while
the model is where the event found it — a `multiple` select's array compared by which options it
chooses, in any order. A handler that skips composing input takes
the word from the ordinary `input` after the composition: Firefox sends one, Chromium does not, and
there the field sends it, once — measured with a real composition in both, typing 日本. It is sent
only while the field's component is alive and its model has not moved since the composition began: a
handler that takes composing input too — keeping the word, changing it, or clearing the field — is not
called twice, a field whose dialog Enter closed is sent nothing, and one a portal
parked off the page still takes the word; it writes only the value, with no render; and it still
runs when the handler throws. A `TextArea` answers `input` only — `change` comes on blur, when
every input has already been answered. A `Select`'s `defaultValue` holds until the
user picks or a `value` holds the field, and applies once an option with that value is there: a
placeholder first and the options from a load still start on the saved choice. One that changes after
the pick leaves the pick showing and is where a reset returns, as a `TextArea`'s is. It is written as the
option's `selected` attribute, so a form's reset returns to it. A `value` of `null` is no value. The app's handler is called as a
listener is, with the element as `this`.
