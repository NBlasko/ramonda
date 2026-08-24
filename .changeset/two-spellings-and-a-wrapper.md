---
"@ramonda/check": minor
---

A keyboard path is recognised in both spellings, and a wrapper is seen through to the element it is

Two rules nobody had planted a shape for, and three gaps between them.

**`click-with-no-keyboard-path` knew one spelling of an event name.** The framework takes two —
`onclick`, and `on:click` which hands the name through verbatim for a custom event with a dash or a
capital that the first form cannot reach. `core/Attribute.ts` decides it, and the new `eventTypeOf`
mirrors that rather than inventing an answer. Measured on a plant: `<div on:click={open}>` was not
recognised as a click handler at all, and — worse — the key handler in
`<div onclick={open} on:keydown={onKey}>` was invisible, so an element whose keyboard path is
written on the same line was reported as having none. `client-only-request-read` had this right and
now reads through the same helper, so a fourth rule cannot drift.

**`interactive-inside-interactive` stopped at any component.** The argument was that what a
component renders is decided inside it. True of most, and not of the one that gets written here: a
wrapper handing `this.props.children` straight back puts them inside its own `@Host` element, so
`<LinkBox><a/></LinkBox>` with `@Host("a")` is a link inside a link that nothing reported.
`tag-needs-its-parent` had already been taught this about the same question, through the same
helper — two rules asking "what is this really inside" two different ways, and this was the wrong
one.

`handsChildrenToTheHost` also accepts `return <>{this.props.children}</>` now. A fragment adds no
element, so the children land on the host either way, and it is how a wrapper is usually written —
both rules were blind through it. Nothing else may be in the fragment: a sibling beside the children
means the host holds more than they do, which is what keeps the claim provable.
