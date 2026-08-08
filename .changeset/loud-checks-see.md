---
"@ramonda/check": minor
---

Two things: a rule for the form field nothing at runtime can report, and a walk that had gone dark

**A component that READS a form field it was handed without watching it.** Such a component never
re-renders — its message never appears, and a write from anywhere else never reaches its input.

```text
[ramonda-check] 1 component(s) reading a form field they do not watch:

  src/TextField.tsx:9:23
    <TextField> reads `bind` from a field in its props, so it will
    never show a change to it — the component does not re-render at all.
```

It cannot be a runtime diagnostic at all, which is why it belongs here: the form would have to know
who is rendering, and nothing in the running page distinguishes "the owner is reading its own field"
from "a child is reading a field it will never hear about again". The fix is `@ramonda/form`'s `Field`
hook.

Only a READ is reported. A component that writes through the field — `set` from a click handler — is
correct as written, and one that passes it down without reading it is a layout. Both stay quiet, along
with the owner reading its own fields. Run against this repository's three apps, 160 components: no
reports.

**And a fix worth more than the rule.** `this.use(Form<typeof schema>, …)` is an instantiation
expression rather than an identifier, so it did not resolve — which marked the owning component
*opaque*, and a component is opaque exactly when the walk STOPS beneath it. Every context consumer
under a form, a query or any hook written with its type argument named had quietly stopped being
judged. The pin is unwrapped now, and a fixture holds the shape: with it, the missing provider is
reported; without it, the report is silence.

And every issue type `AnalyzeResult` carries is nameable now. `DuplicateDecoratorIssue` and
`UnwatchedFieldIssue` were not exported, so a script written against `analyzeProject` — which the
reference tells people to write — could type a variable holding a context issue but not one holding a
duplicate decorator.
