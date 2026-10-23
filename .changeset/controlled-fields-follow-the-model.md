---
"@ramonda/core": minor
---

A field with a `value` shows the model, in the event that changed it; `defaultValue` and `defaultChecked` start a field the user owns

`Select`, `TextArea` and `<input>` are controlled the same way: a field with a `value` — `checked` on a
checkbox or a radio — shows what the model holds, and the handler written on the field is what writes
the model. Core answers every edit in the field's own listener, before the event bubbles to anything
around the field and before the browser draws: the edit is decided by the field's `transform`, the field's handler runs, the
renders it caused run at once, and the field shows the model. A handler that takes the edit leaves
the field as the user made it; one that refuses it, or no handler at all, leaves the model showing —
in the same event, so a refused keystroke or pick is never drawn, and a form around the field reads
the value the field keeps.

```tsx
typed(event: EventOn<HTMLInputElement>) {
  this.email = event.currentTarget.value;
}

<input aria-label="Email" value={this.email} oninput={this.typed} />
```

A select, a checkbox and a radio pick in one move: both of the field's own `oninput` and `onchange`
run on the `input`, and the `change` after it finds nothing left to do. A radio the handler refuses is
put back with its whole group.

`transform(next, prev, input)` on any of the three decides an edit before the handler reads it, and is
pure: returning `prev` refuses the edit and puts back the
selection the edit found, read at its `beforeinput`; `input` gives the edit's
`inputType` and the caret, for a mask. A refused edit is no edit, on every field: neither `oninput` nor
`onchange` of the field runs, so no handler has to tell a refused edit from a real one — a radio's
`value` is the same on or off, and a handler reading it never writes the pick it refused. On a
checkbox or a radio `transform` is told whether the box is checked; a word an input method commits is
decided once it ends, and a refused word is handed to no handler.

An input method's word is one edit. While it is composed, its `input` events reach no handler of the
field and the field is not written; when it ends, the word is decided by the `transform` and handed
to the field's `oninput` once, at `compositionend` — the same in Chromium, which sends nothing more,
and in Firefox, whose `input` after it is recognised and not handed over a second time. So a handler
never asks `isComposing`, and a `transform` holds for every word typed through an input method. A
model the app moves in the middle of a word wins over it, and a blur keeps the composition going
until its `compositionend` or the next ordinary edit.

`defaultValue` (and `defaultChecked`) starts a field the user owns — for a form whose fields are read
when it is sent. It is written as the field's default — the `value` attribute, the `checked`
attribute, the option's `selected` — so a served page shows it before any script runs, and a form's
reset returns to it. A `value` of `null` or `undefined` is no value. The field's handler is called as a
listener is, with the element as `this`, and may be a function or a listener object; one written
`on:input` — a type error now, see below — reaching the field anyway is its own as much as `oninput`.
A field the end of a composition removes — Enter closing its dialog — hands the word to no handler.

`on:` before a standard event is a type error that names the spelling: `on:input` is written
`oninput`, on every element and on `Select` and `TextArea`. `on:` is for an event `on…` cannot
spell, a custom one with a dash.

Each handler is handed the event it is promised: `oninput` an `input` — the word an input method
commits arrives as one, `insertCompositionText` — and a pick's `onchange` a `change`, whose
`stopPropagation()` stops the browser's own `change`. A transform that answers nothing refuses the
edit.
A `file`, `hidden`, `submit`, `reset`, `button` or `image` input holds no model, whatever its `value`;
and when a field's handler throws, its error is the one thrown, and the error of the render of what it
half wrote is reported as an uncaught one; a `transform` that throws leaves the field showing the model.
A `change` ends the edits before it — on blur, or right after a date's, a color's or a range's
`input` — or is an edit of its own. When the field shows its model, the `change` brings nothing new:
it runs `onchange` when an edit since the last `change` was kept and the text is not back to what it
was, decides nothing again, and reaches no handler when every edit was refused, a word was overtaken
by the app's own write, the edits put the text back — a browser sends no `change` for those — or there
was none. When the field shows something else — an
autofill, or a change dispatched alone, on any field, a `TextArea` included — it is an edit, decided
by the `transform` and handed to `oninput` as an `insertReplacementText` input, then to `onchange` as
the change. An event sent while a commit is running is answered against what the field showed after
the last event in it, since the render that writes the model has not run yet.
