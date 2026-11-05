---
"@ramonda/check": minor
---

`field-the-user-cannot-change`: a controlled field no handler on it can change

A field with a `value` — a `Select`, a `TextArea`, an `<input>`; `checked` on a checkbox or a radio —
shows the model, and only the handler written on the field writes it. Reported, each provable from the
source: no handler on the field (`oninput`, or for a pick `oninput` or `onchange`, either also written
`on:input`, `on:change`); a text field with
only `onchange`, which comes on blur, so every keystroke is undone before it; `value` beside
`defaultValue`, or `checked` beside `defaultChecked`; a field whose model is a literal — `value=""`,
`checked={true}` — or a `const` holding one; a spread on a controlled field, except the schema's
constraints, `html(path)` from `@ramonda/form/bguard` (made into a `const` or a class's field), which
`reset-the-model-does-not-hear` and `form-value-in-the-wrong-control` read through as well; and a spread of a prop, which is read where the component is used; a handler taken from a prop declared optional; a date, time, color or range with only `onchange`, which comes after the `input`
the field already answered; and a box picked through `onclick`, which writes the
model before the field decides the pick. Not reported: a field
`disabled` as written, a text field that is `readonly`, an `<input>` whose type is not edited
(`hidden`, `submit`, `button`, `reset`, `image`, `file`), and a `value` written as `null` or
`undefined`, which is no model.

`option-that-cannot-choose` reports an `<option selected>` only inside a `Select` with a `value`, a
`defaultValue`, or a spread that may carry one. `attribute-that-does-nothing` takes `defaultValue` and
`defaultChecked` as written on an `<input>`, a `Select` and a `TextArea`, where they start an
uncontrolled field. `fresh-object-in-props` says what core compares by content. `dev-guard-as-an-expression`
reads an empty arm in parentheses, `__DEV__ ? publish() : (null)`, as empty, and every rule asks about
`null` and `undefined` the same way.
