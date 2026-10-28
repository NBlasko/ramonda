---
"@ramonda/check": minor
"@ramonda/form": minor
---

`form-value-in-the-wrong-control` and `RMF005`: a form's number or day in a control that hands back text

A field turns what its control produced back into its value by the control's own `type`:
`type="number"` hands back a number, `type="date"` a day, and every other control its text. A number
field written without `type="number"` fills the form with text, and the schema reports a value the
reader never typed wrong.

```tsx
<input type="number" name={age.name} value={age.inputValue} oninput={age.oninput} />
```

`inputValue` is typed `FormNumber | ""` for a number and `FormDay` for a date — a number and a string to
TypeScript, marked so the check can tell them from any other. `ramonda-check` reports one in any other
control, in an `<input>` whose `type` it cannot read, and an `inputValue` whose type it cannot read.
A project that imports `@ramonda/form` is read with types for it — the language's own lib, and stand-ins
for the DOM names core's and the form's declarations mention, generated from them, in place of the
DOM lib. `RMF005` reports the same in a running page once the field holds a number or a day.
