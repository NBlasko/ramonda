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
for an emptied one), text as text; a checkbox takes `checked={field.value === true}` — a value not set
yet, or cleared by a reset, is an unticked box core still holds, as `bind` wrote it — and `type` is written on
the element. `oninput` and `onblur` are one bound function each for the life of the field. `Field`
answers the same four. The `Bind`, `CommonBind`, `TextBind`, `NumberBind`, `CheckboxBind` and
`DateBind` types are gone; `InputValue<T>` types `inputValue`. What an edit writes is read off the
control as written: `type="number"` writes a number and `type="date"` a day, so a number field is
written `type="number"`, as a box is written `type="checkbox"` — the `type` `bind` used to write.
`invalid` is `true` while the field has a message and no value otherwise, as `bind` gave it: a valid
control carries no `aria-invalid`.
`inputValue` is typed per member of the value's union, and `never` for a value a control's `value`
cannot show — a boolean (a box takes `checked`), a file, a bigint.
