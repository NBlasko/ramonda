---
"@ramonda/form": minor
---

A field's `$` gives a control each attribute by name — `inputValue`, `invalid`, `oninput` and `onblur`, beside `name` and `value` — and `bind` is gone

A control is written with five attributes, every one where the control is:

```tsx
const email = this.form.fields.email.$;

<input
  name={email.name}
  value={email.inputValue}
  oninput={email.oninput}
  onblur={email.onblur}
  aria-invalid={email.invalid}
/>
```

`inputValue` is the value as the control shows it: a `Date` as `yyyy-mm-dd`, a number as itself (`""`
for an emptied one), text as text; a checkbox takes `checked={field.value}`, and `type` is written on
the element. `oninput` and `onblur` are one bound function each for the life of the field. `Field`
answers the same four. The `Bind`, `CommonBind`, `TextBind`, `NumberBind`, `CheckboxBind` and
`DateBind` types are gone; `InputValue<T>` types `inputValue`.
