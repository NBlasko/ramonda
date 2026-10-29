---
"@ramonda/check": minor
"@ramonda/form": minor
---

`form-value-in-the-wrong-control` and `RMF005`: a form's value in a control that hands back another kind

A field turns what its control produced back into its value by the control's own `type`:
`type="number"` and `type="range"` hand back a number whatever the field held — a slider now writes a
number, as an empty field cannot say what it is waiting for — and every other control its text.
`type="date"` serves a `Date` and a date written as text, told apart by the value the field holds: text
(a date written as text starts at `""`) gets text back, and a `Date` or nothing gets a day — so a `Date`
field that held none now takes a day rather than text, and one emptied holds nothing rather than `""`. A number field written
without `type="number"` fills the form with text, a text field in a slider fills it with a number, and
the schema reports a value the reader never typed wrong.

```tsx
<input type="number" name={age.name} value={age.inputValue} oninput={age.oninput} />
```

`inputValue` is typed `FormNumber | ""` for a number, `FormDay | ""` for a date and `FormText` for text —
a number and two strings to TypeScript, marked so the check can tell them from any other; all three are
exported. `ramonda-check` reports each in a control that hands back another kind, in an `<input>` whose
`type` it cannot read, and an `inputValue` whose type it cannot read.
For it, `ramonda-check` now reads every project with the language's own lib and, in place of the DOM
lib, a stand-in for each name it declares, read from the DOM lib of the TypeScript the check runs —
about 0.2 s more per run, whatever the app's size (measured on a Linux laptop, Ryzen 5 2500U). A
rule that told the platform's names from a project's own by whether they resolved asks which file
declares them now. `RMF005` reports the same in a running page once the field holds a number or a day.
