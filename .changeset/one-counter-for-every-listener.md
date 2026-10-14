---
"@ramonda/core": patch
---

A list row no longer takes another listener's place on a signal

A `State` keeps its listeners in a map keyed by id. Every listener drew its id from `createId()`
except a list row, which counted from 1 on a sequence of its own — so a row could draw the number a
`@compute`, an effect or a component runtime already held, and replace it. Whichever attached second
won. A compute that lost served its first value for ever: `list(rows, (r) => <i>{this.price}</i>)`
with `@compute price` showed the old price in every row after its source changed. A row that lost
kept its old text while every row around it changed. Which number collided depended on how many ids
and rows the page had made, so in an app it came and went.

Rows now draw from `createId()` like everything else. `RowListenerIds.test.tsx` forces the collision
by rendering more rows than ids handed out; with the old sequence back, the compute test fails on all
101 rows and the effect test on exactly one.

`ScopeCleanup.test.tsx` had counted 4 listeners on a provider's signal where there are 5: row "b"
had drawn the provider owner's number and replaced it. Its counts are corrected, and with an engine
that is never disposed it still fails.
