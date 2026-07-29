---
"@ramonda/query": patch
---

A `@compute` that reads a query now follows it, instead of freezing on the first value it saw.

The failure was silent and total. The cache is not reactive — an entry is a plain object, and
what wakes an observer is the `version` increment in `notify`. A render re-reads `data`,
`status` and the rest on every pass, so it always looked correct; a `@compute` caches, and a
compute that read no signal is never invalidated. Measured:

```
@compute get name() { return this.user.data?.name }   // "—", forever
this.user.data?.name                                   // "Ada 4"
```

The compute had cached `undefined` from before the data arrived and never looked again.

One signal read inside the `entry` getter fixes it, so every reader — render, compute,
watcher — depends on the one thing that changes when the entry does. It costs no extra render,
which is the point of using the version signal rather than adding another: that increment IS
the wake-up, so there is nothing else to schedule. Verified — one unrelated state change still
produces exactly one render.

Found while asking whether `select` needs to exist or whether a `@compute` over `data` is
enough. It was not enough, for a reason that had nothing to do with `select`.
