---
"@ramonda/core": patch
---

`merge`'s bounds are tested, and two comments that disagreed about them no longer do

`base/merge.ts` declares two limits — `MAX_DEPTH` 50 and a `BUDGET` of 20 000 — and `Merge.test.tsx`
reaches neither. It covers what merge SHARES: equal values, a changed row among unchanged ones,
reorders, identity, duplicates, the positional fallback. The limits are the half that fails
silently: a bound that stops working costs a stack overflow or a hang, not a wrong value.

Two comments in the repository disagreed about which bound makes a cycle safe. `merge.ts` says depth
("a budget alone is not enough, and a test proved it"); `@ramonda/query`'s cycle test said "the node
budget is what makes this safe". Measured: a 60-deep pair of equal chains comes back unshared and a
40-deep pair comes back shared, so depth is what cuts a self-cycle at 50 frames. The budget cannot
be — `walk` returns at `Object.is(previous, next)` before spending anything, so equal leaves cost
nothing and 30 000 equal keys are still shared. The query comment is corrected.

Also pinned: a null-prototype object IS traversed (the plain-object test names it), a `Date` is not,
and a key set that grew, shrank or was renamed comes back as the object handed in — asserted by
identity rather than contents, because a rebuilt object with the same contents passes `toEqual` with
the guard removed.
