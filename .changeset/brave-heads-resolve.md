---
"@ramonda/check": minor
---

`head-tags-collide` and the context pair read a value one name away.

**`head-tags-collide` could not read options kept in a module** — `this.use(Head, PAGE_HEAD)`
reached no object literal at all, so a description written both ways inside it was invisible. Page
metadata living in a module of its own is the ordinary arrangement, and the whole argument for this
rule is that nothing else can see the collision: the type permits it, `tsc` says nothing, and by the
time the runtime has built its map the losing tag has left no trace.

A `{ name: ROBOTS }` identity is now read the same way. `this.which` still is not, and that is a
different case rather than the same one — a field can be written again, so the identity really is
not knowable.

**A Provider under a local name is the same Provider.** `resolve` already followed an IMPORT alias,
so `ThemeProvider as Publishes` was never a question; a second `const` in the file was, because the
declaration behind it is a `VariableDeclaration` rather than the `BindingElement` the pair was
destructured from. `one-provider-per-component` and `context-consumed-above-its-provider` both read
through this, and both were silent on it.

No change to what is reported on any project in this repository.
