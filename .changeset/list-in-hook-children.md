---
"@ramonda/core": minor
---

`list()` works wherever a hook consumes renderable children, not only in a render slot.

A `list()` handed to a hook — `this.use(Portal, () => ({ children: list({ each, as }), target }))` — used to crash: the descriptor fell into the diff's component branch with no `.name`. It now goes through the real region reconcile, so it gets what a list in `render()` gets: minted identity, per-item reactive scopes, the whole-list skip, and the LIS reorder.

The mechanism is a new internal `ChildrenRegion` — a contiguous block of children owned by something other than an element's render, with a record of its own and a trailing anchor so it can share a target with the shell's content and with other portals. `Portal` is rewritten on top of it and no longer hand-rolls a reconcile.
