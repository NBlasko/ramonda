---
"@ramonda/check": minor
---

A new rule: **`row-reads-a-plain-field`** — a `list()` row callback that puts a field nothing can track
into the markup.

A row is rebuilt when something it READ has moved, and the reads are recorded while the callback runs.
A plain field is not a signal, so nothing is recorded and nothing marks the row. Measured, one field read
twice in one component: `new` in the markup outside the list, `old` in the row.

**This is the only place the check can live.** A plain field read is a property access and leaves no
trace, so the runtime has nothing to observe — and the double render compares two calls in one tick,
where the field holds the same value both times. The declaration is the only evidence there is.

**Every silence is a decision, and half the fixture is silences.** An inline callback (every row rebuilds
anyway). A field nothing writes. A field written only in `@created`, which runs before the first row. And
a read that never reaches the markup — `this.socket.send(…)`, `this.observer.observe(el)` — because a
plain field is the only home for anything that cannot be JSON, and `@state` and `@persist` must be.

**And it says what it cannot see.** `<li>{labelOf(this)}</li>` hands the component to a function that
reads it elsewhere, so the reads are not in this declaration. Rather than going quiet, the rule reports the
shape — a proven fact rather than a guessed defect — which is what makes the guarantee sayable: a row
callback either reads its members where this can see them, or it says it does not. Measured across this
monorepo, 53 calls take a bare `this` and every one is inside the framework itself; none in application
code, none in a row callback.

A warning rather than an error, because one thing is not provable from the declaration: WHEN the write
happens. A write that also replaces the array rebuilds every row anyway.

Zero reports across `apps/docs`, both playgrounds, `core`, `query`, `router`, `form` and `devtools`, with a
planted violation confirming the rule is reachable rather than silently gated.
