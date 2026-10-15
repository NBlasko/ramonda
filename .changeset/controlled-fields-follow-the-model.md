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
alone — a settle that comes due while one is under way waits for the next ordinary input; it writes only the value, with no render; and it still
runs when the handler throws. A `TextArea` answers `input` only — `change` comes on blur, and
answering it undid a composition the app had not taken yet. A `Select`'s `defaultValue` holds until the
user picks or a `value` holds the field, and applies once an option with that value is there: a
placeholder first and the options from a load still start on the saved choice. A `value` of `null` is no value. The app's handler is called as a
listener is, with the element as `this`.
