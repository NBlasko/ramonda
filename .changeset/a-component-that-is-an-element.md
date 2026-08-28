---
"@ramonda/check": minor
---

The tag rules read `<Select>` and `<TextArea>` as the elements they are

`<select>` and `<textarea>` are refused by core's own types, because neither can be written
correctly as a tag: a select's choice is decided by the order its options reached it, and a
textarea's value is its CHILD rather than an attribute. `Select` and `TextArea` settle both — and
left the checker meeting a COMPONENT where the tag used to be.

Measured: `<Select aria-hidden="true" httpEquiv="refresh">` with no label at all was reported by ONE
rule, while the identical faults on an `<input>` beside it were reported by four. Every rule keyed
on a tag went quiet for the two elements an author now has no other way to write.

**A table, not a walk.** The obvious answer is to read the component's `render` and see what it
builds, and it works inside this repository and nowhere else: an application resolves `Select` to
core's `.d.ts`, a declaration with no body. There is no render to read. A reader built that way
would pass every fixture here and do nothing for the people the rules are for.

**Identity is the name core EXPORTS**, through `resolve.coreName` — so core's `Select` under an
alias is reported and an application's own component of the same name is its own business. That
reader hangs on the resolver precisely so it reaches everywhere the resolver does, which is why this
needed no new parameter threaded through the element pipeline.

`control-with-no-label` needed a second fix and it is the standing lesson again: the element family
reads its tag through `contextFor`, while the id table walks the JSX itself and asked `tagOf`
directly — so it decided `<Select>` was not a form control at all. One question, two readers, and
only one of them had been taught.
