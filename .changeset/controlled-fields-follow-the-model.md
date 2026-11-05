---
"@ramonda/core": minor
---

A field with a `value` shows the model, in the event that changed it; `defaultValue` and `defaultChecked` start a field the user owns

`Select`, `TextArea` and `<input>` are controlled the same way: a field with a `value` — `checked` on a
checkbox or a radio — shows what the model holds, and the handler written on the field is what writes
the model. Core answers every edit in the field's own listener, before the event bubbles to anything
around the field and before the browser draws: the field's handler runs, the renders it caused run
at once, and the field shows the model. The handler decides the edit by what it writes — the edit to
take it, something else to rewrite it, nothing to refuse it. A handler that takes the edit leaves
the field as the user made it; one that refuses it, or no handler at all, leaves the model showing —
in the same event, so a refused keystroke or pick is never drawn, and a form around the field reads
the value the field keeps. A refused edit puts the caret and the selection back where the edit found
them: a paste over `hello` selected leaves `hello` selected again — on the field that has the focus.
A number field whose model is a number is shown by every text of that number, so `1.50` stays while
the user types toward `1.505`; one whose model is text is shown only by that text.

```tsx
typed(event: EventOn<HTMLInputElement>) {
  this.email = event.currentTarget.value;
}

<input aria-label="Email" value={this.email} oninput={this.typed} />
```

A select, a checkbox and a radio pick in one move: both of the field's own `oninput` and `onchange`
run on the `input`, and the `change` after it finds nothing left to do. A radio the handler refuses is
put back with its whole group.

A word typed through an input method reaches the field's `oninput` at every step, as the browser
sends it, `isComposing` saying it is not finished — so a search or a count follows the user on an
Android keyboard, which composes every word. The field is not written while the word is composed.
A handler that waits for the finished word returns while `isComposing`, and is handed the word once,
at `compositionend` and before `oncompositionend` — Chromium's last `input` of a word still says
`isComposing`, and nothing follows its end; Firefox's own `input` after the end is recognised and
not handed over again. A handler that refuses or rewrites waits for the finished word, so it never
keeps half of one. A model the app moves in the middle of a word wins over it, and a blur keeps
the composition going until its `compositionend` or the next ordinary edit.

`defaultValue` (and `defaultChecked`) starts a field the user owns — for a form whose fields are read
when it is sent. It is written as the field's default — the `value` attribute, the `checked`
attribute, the option's `selected` — so a served page shows it before any script runs, and a form's
reset returns to it. A default that changes later moves the field while it shows its default, and
otherwise only where a reset returns: the user's pick stays, and a `Select` whose picked options are all
replaced shows its default again. A `Select` with neither starts on its first
option a reader can choose, on the client as on a served page, and so does one whose options all arrive
later or are all replaced: the children a render adds go in first to last, as a parser puts them. A `value` of `null` or `undefined` is no value. The field's handler is called as a
listener is, with the element as `this`, and may be a function or a listener object; one written
`on:input` — a type error now, see below — reaching the field anyway is its own as much as `oninput`.

`on:` before a standard event is a type error that names the spelling: `on:input` is written
`oninput`, on every element and on `Select` and `TextArea`. `on:` is for an event `on…` cannot
spell, a custom one with a dash.

Each handler is handed the event it is promised: `oninput` an `input` — the word an input method
finishes is handed over as one, `insertCompositionText` — and a pick's `onchange` a `change`, whose
`stopPropagation()` stops the browser's own `change`.
A `file`, `hidden`, `submit`, `reset`, `button` or `image` input holds no model, whatever its `value`;
and when a field's handler throws, its error is the one thrown, and the error of the render of what it
half wrote is reported as an uncaught one; a handler that throws before it writes leaves the field
showing the model.
A `change` ends the edits before it — on blur, or right after a date's, a color's or a range's
`input` — or is an edit of its own. When the field shows its model, the `change` brings nothing new:
it runs `onchange` when an edit since the last `change` reached the handler and the text is not back
to what it was, hands `oninput` nothing again, and reaches no handler when every edit was refused, the edits put the text back — a browser sends no `change` for those — or there
was none. When the field shows something else — an
autofill, or a change dispatched alone, on any field, a `TextArea` included — it is an edit, handed
to `oninput` as an `insertReplacementText` input, then to `onchange` as the change. An event sent
while a commit is running is answered against what the field showed after the last event in it,
since the render that writes the model has not run yet — so whether the handler refused that event
is not known, and RMD062 reports it.
