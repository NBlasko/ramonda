---
"@ramonda/core": patch
---

What the debug labels say when they have nothing to say

Four branches, one subject, and neither test run had ever taken any of them: the else arm of
`stateLabels.ts`'s `label.owner ? … : label.property`, and the `?? "a signal"` in each of
`renderPhase.ts`'s three reporters — the write during a render, from `[INSPECT]()`, and from a
`@compute`.

They were unhit because no ordinary use reaches them. A signal is labelled only when it is built with
`metaData`, and the framework builds three kinds: `@state` passes both `metaData` and an `owner` that
is `displayName(this)`, which answers `"Unknown"` rather than `undefined` for a nameless class and so
is never falsy; the other two are props signals, built with no `metaData` at all. And a write to
props never reaches `State.set` — the proxy's `set` trap throws `[RMD004]` in every build, outside
`if (__DEV__)` — so the report those fallbacks belong to cannot be raised about the one kind of
signal that has no label.

So both exist because the options are optional, and what they promise is a graceful degradation. That
is what is pinned: a label with no owner reads `items` rather than `undefined.items`, and an
unlabelled signal makes a message say `a signal` rather than leaving a hole in it. Each reporter is
also asserted to stay silent when its phase is not marked, because the tests set those phases by hand
and a reporter that fired regardless would have passed everything else.

Measured after: `stateLabels.ts` and `renderPhase.ts` have no unhit branch left between them, 0 of 4
and 0 of 14, and files with every branch taken by one run or the other are 32 of 83, from 30.
