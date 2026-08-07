---
"@ramonda/check": patch
---

A duplicate decorator report says what the second declaration actually does

One report, four faults, four pieces of advice — because "one of them never runs" is true of exactly one
of them, and naming the wrong one sends a reader after a difference that is not there.

**`refuses`** — `@Host`. It throws (RMD045): two element names have no union, so there is no live
declaration to look for.

**`displaces`** — `@catchError`, `@ShouldUpdateOnPropsChange`. One wins, the rest are dead code, and the
report says WHICH is live.

**`merges`** — `@StableProps`. Both take effect and the result is the union (RMD046); nothing is lost and
only the spelling is redundant.

**`redundant`** — `@state`, `@compute`, `@persist`, `@memoizedHandler` on one MEMBER twice. Measured in
core rather than assumed: a doubled `@state` renders once per write with the right value, and
`@compute`'s body runs once for two reads. Nothing is displaced, so the advice is "delete the extras",
not "work out which line is live" — that would send somebody after a difference that does not exist.

Counting the redundant kind per class reported `<Search> declares @state 5 times` against this
repository's own documentation app, where five different fields each carry one. It is per member now, and
the report names the member: `RedundantTwice.n carries @state 2 times`.

`@watchProp` is deliberately not in either set: several on one method is the supported way for one
handler to follow several props, and each application does real work.
