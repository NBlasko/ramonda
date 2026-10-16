---
"@ramonda/check": minor
---

`field-the-user-cannot-change`: a `Select` or `TextArea` whose `value` nothing moves

Core settles a field with `value` from the model after every input, so a field the model never
follows undoes every input. Reported, with which of three it is: `value` and no `oninput` /
`onchange`; a `TextArea` with `value` and only `onchange`, which comes on blur, so every keystroke is
undone before it; and `value` beside `defaultValue`, where `defaultValue` says nothing. The advice
is a handler that moves the model, or `defaultValue` for a field the form sends. Not reported: a
`value` written as `{null}` or `{undefined}`, which core treats as no value (a `defaultValue` written
so is no default either); an
element with a spread, since `{...bind}` from `@ramonda/form` carries the handler; a field that is
`readonly` or `disabled` as written (bare, `{true}`, `"true"`, or a const holding it), which takes no
input; a field with a handler on an element — not a component — around it that moves the model in
time (`input` for a `TextArea`, whose `change` comes on blur); and a field whose `value` IS a prop
(`this.props.text`, `props.text ?? ""`), whose handler may be in the parent's render — a prop used
only as a key, `drafts[this.props.id]`, is still reported.

`option-that-cannot-choose` names `defaultValue` for a choice the user owns, and reports an
`<option selected>` only inside a `Select` that has a `value` or a `defaultValue`, or a spread that may
carry one — a select with neither, or with `value={null}`, leaves the choice to the option. `attribute-that-does-nothing` no longer reports `defaultValue`
on a core `Select` or `TextArea`, where it is a prop, imported by name or through a namespace
(`ui.Select`). And
`fresh-object-in-props` says what core compares by content now.
