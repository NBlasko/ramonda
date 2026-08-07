---
"@ramonda/check": patch
---

Two decorators on one MEMBER, counted per member and told apart from two on one class

The duplicate report grew a second fault, and the two need counting at different levels — getting that
wrong is not a near miss, it is a false positive on ordinary code.

**`displaces`** — `@catchError`, `@Host`, `@ShouldUpdateOnPropsChange`, `@StableProps` answer a question
the CLASS asks, so two anywhere in the body is the fault and one of them is dead code.

**`redundant`** — `@state`, `@compute`, `@persist`, `@memoizedHandler` on one MEMBER twice. Measured in
core rather than assumed: a doubled `@state` renders once per write with the right value, and
`@compute`'s body runs once for two reads. Nothing is displaced, so the advice is "delete the extras",
not "work out which line is live" — that would send somebody after a difference that does not exist.

Counting the redundant kind per class reported `<Search> declares @state 5 times` against this
repository's own documentation app, where five different fields each carry one. It is per member now, and
the report names the member: `RedundantTwice.n carries @state 2 times`.

`@watchProp` is deliberately not in either set: several on one method is the supported way for one
handler to follow several props, and each application does real work.
