---
"@ramonda/core": minor
---

An object changed in place is now reported — RMD034

`this.items.push(x)` has always been caught. `this.user.name = "x"` was the identical fault and was
silent: a signal fires when it is ASSIGNED a new value, so writing into the value it already holds
changes nothing it can compare, nothing re-renders, and the page goes on showing what it showed
before. The asymmetry was invisible, and the docs made it worse by saying both were caught.

The guard wraps **lazily**, along the path a render reads: a `get` returns a guarded child only when
something asks for that child, so reading `user.name` costs two proxies whatever the size of `user`,
and a component that never touches `user.address` never wraps it. Nested changes are reported by
their path — `user.address.city` rather than "an object in state" — and the message points at the
replacement, including the `@ramonda/lens` form.

A `Date`, a `Map` and a class instance are left alone: their methods need the real receiver, and
wrapping them would break working code for a report nobody asked for. Development only, as ever.

Measured on a dev update of 3000 rows reading two levels of object state plus an array element:
49.1 ms → 57.1 ms, **+16%**. The first version cost 30% and was wrong: a proxy escapes into user code
the moment anything copies (`[...this.rows]` spreads guarded children), and wrapping an escaped proxy
again gives an identity nothing has seen — a no-op render moved 200 of 200 list nodes. Guard proxies
are now recognised and handed back as they are, which is what both the correctness and the other half
of the cost came from.
