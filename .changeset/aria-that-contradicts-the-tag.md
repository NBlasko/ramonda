---
"@ramonda/check": minor
---

New rule: `aria-that-contradicts-the-tag`

`<input required aria-required="false">`. `<button disabled aria-disabled="false">`. The HTML
attribute is doing its job — the form will refuse to submit, the button will not take a click — and
the ARIA one **overrides what a screen reader is told about it**. The reader hears that the field is
optional and then cannot submit, or that the button is available and then nothing happens when they
press it.

It is worse than either half missing. A control with nothing said about it leaves a reader to find
out by trying; a control that says the opposite of what it does sends them looking for a fault
somewhere else on the page. Somebody told a required field is optional does not go back to it — they
go hunting through the rest of the form.

Nobody sets out to contradict themselves. It arrives when ARIA is added "to be safe" beside markup
that already said the same thing and the value lands on the wrong side of a condition, or when
`required` is added later to a field whose `aria-required="false"` nobody re-read. Both leave a page
that works perfectly for anybody using a mouse.

Six pairs, from the HTML accessibility mappings — the ones where the HTML attribute is a plain
boolean and its ARIA counterpart a boolean token: `required`, `disabled`, `checked`, `readonly`,
`hidden` and `open`.

**Agreement is untidy and is not reported.** `aria-required="true"` beside `required` says one thing
twice; this package reports faults rather than habits. And anything the source does not settle on
both halves is left alone — `disabled={busy} aria-disabled={busy}` is the correct way to write a
pair that moves, and is exactly what a rule that guessed would report.

Found by planting a broad sweep of markup and reading which lines nobody spoke about — the third
finding from that method, after the empty `<button>` and the empty naming attribute.
