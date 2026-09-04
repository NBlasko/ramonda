---
"@ramonda/core": patch
---

What a children region does once there is nothing left for it to do

Twelve branches of `core/childrenRegion.ts` had never been taken by either test run, and reading them
together says why: most are the `disposed` early return on each method, and they were unhit precisely
because no ordinary path calls a method after `dispose()`. They are the promise that a torn-down
region is inert, and the guards exist for the arrangement the framework is careful never to produce.

`ChildrenRegion` is exported and takes a `MaybeComponent` owner, so a bare one can be driven without
a component at all — it reconciles `"hello"` into `<!--r1-->hello<!--/r1-->` and `dispose()` empties
the parent. Twelve tests now hold: `anchorId` on an opening anchor, a closing one, a comment that
only looks like one and a node that is not a comment; a disposed region reconciled, told its host is
gone, asked to hydrate, and disposed again; an empty block that still writes its anchors; and a
region's own refresh, which is reached the way its comment describes — an item reading a signal the
props factory never read, so the factory's cache stays clean.

Eight of the twelve are closed, and the file says what each of the remaining four needs. Two are
`invalidate`'s: `!owner` needs a region built without one, and the only constructor call passes a
hook's owner; the guard inside its post-commit callback needs a region disposed while its owner
lives, and `Portal` disposes only from `@destroyed`. The other two are the hydration tail scan's
nesting count, which needs a server block holding another block where this render wants fewer
children — reachable, and not built here.

Two of the tests state what they do NOT prove, which is the honest half. Taking a branch is not the
same as falsifying it: with `refreshQueued` removed the DOM is identical and the mapper still runs
exactly twice, and with `dispose()`'s own flag removed a second teardown still removes nothing twice.
Both pin the outcome a caller depends on and say the guard itself is invisible from outside.
