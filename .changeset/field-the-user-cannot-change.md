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
`disabled` as written (bare, `{true}`, `"true"`, or a const holding it), or a `TextArea` that is
`readonly`, which takes no input (`readonly` does nothing to a `Select`, which is still reported); a field with a handler on an element — not a component — around it that moves the model in
time (`input` for a `TextArea`, whose `change` comes on blur), or with a spread on a `form` or
`fieldset` around it, which may carry one; and a field whose `value` IS a prop or a parameter
(`this.props.text`, `props.text || ""`, either arm of a ternary, `String(this.props.size)`,
`this.props.text.trim()`, a template, or a name taken from the props — `const { text } = this.props`, `const own = this.props`
and `own.size`), whose handler may be in the parent's render — a prop used
only as a key, `drafts[this.props.id]`, is still reported. A row of a `map`, `flatMap` or `list` is
followed to what the call walks: `this.rows.map((row) => <TextArea value={row.text} />)` is the
component's own model and is reported, `this.props.rows.map(…)` and `ui.list(this.props.rows, …)` are
not, and a callback of any other call is silent.

`option-that-cannot-choose` names `defaultValue` for a choice the user owns, and reports an
`<option selected>` only inside a `Select` that has a `value` or a `defaultValue`, or a spread that may
carry one — a select with neither, or with `value={null}`, leaves the choice to the option. `attribute-that-does-nothing` no longer reports `defaultValue`
on a core `Select` or `TextArea`, where it is a prop, imported by name or through a namespace
(`ui.Select`). And
`fresh-object-in-props` says what core compares by content now. `dev-guard-as-an-expression` reads an
empty arm in parentheses, `__DEV__ ? publish() : (null)`, as empty, and every rule asks about `null`
and `undefined` the same way.
