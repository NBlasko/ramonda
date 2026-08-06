---
"@ramonda/core": patch
---

A control the user has touched now follows the model again

`value` and `checked` are the two attributes that stop describing their element the moment someone
interacts with it. Typing changes `input.value` and leaves the `value` attribute where it was;
clicking a checkbox changes `.checked` and sets the dirty-checkedness flag, after which the `checked`
attribute never drives the box again. The diff compared the model against those attributes only — so
it compared the model against a stale record of itself, agreed, and wrote nothing, while the control
went on showing whatever the user had left there.

Concretely: an `<input value={this.text}>` the user typed into kept the typed text through later
renders, and a `<input type="checkbox" checked={this.on}>` the user clicked ignored the model from
then on, in both directions — `checked={false}` could not untick it, because removing an attribute
cannot untick a dirty box.

The attribute comparison is unchanged; the live property is now consulted as well, and the property
is written alongside the attribute. An untouched control still compares equal and is not rewritten,
which matters: writing `.value` sends the caret to the end. `checked={undefined}` is still an
uncontrolled box and is left alone.

One case remains open by design: a handler that REJECTS a keystroke — clamping the length, say — and
so leaves `@state` unchanged schedules no render at all, and nothing re-applies the value. Making
that work means deciding what an input with a `value` and no handler is, which is a design question
rather than a defect in the diff.
