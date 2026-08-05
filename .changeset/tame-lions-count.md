---
"@ramonda/core": minor
---

The JSX factories return `VNode`, and a list item that is not an element is reported (RMD031)

`__h`, `jsx`, `jsxs` and `jsxDEV` declared `RamondaNode`, which is `VNode | VNode[]` — but every tag
the types accept builds exactly one element. The wide return described only an unreachable branch (a
function in tag position, which TypeScript already rejects at the call site) and cost every caller
that builds a vnode by hand a cast back: a route table generated from a content directory, a table
cell, a test that bootstraps a component. Those casts are gone.

**RMD031 — a list item that is not an element.** A list writes each row's key onto the vnode it gets
back, and the diff matches rows on that key, so one item has to become one element. Anything else had
no `attributes` and threw `Cannot set properties of undefined (setting 'key')` — a message about the
assignment rather than about what to write instead. The item is now named and skipped, in production
too, so the page loses one row instead of the whole tree.

The case it is about is a nested list: a list of pages, each holding rows. The inner `list()` is a
descriptor, not an element, so nesting goes through a component — `as: PageView` — whose host element
wraps the inner rows and carries the key.
