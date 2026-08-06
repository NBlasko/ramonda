---
"@ramonda/core": patch
---

Four things the docs left for a reader to discover

**A `@compute` recomputes when you READ it**, not when the change happens. A `@state` write marks it
stale and goes on. So a compute nothing reads costs nothing — a value behind a closed panel is not
recalculated while the panel is closed — and the work lands in whoever asks for it rather than in the
write.

**Refusing a props update drops it whole.** `@ShouldUpdateOnPropsChange` returning `false` does not
take the props either, so a later render caused by the component's own state still shows the props it
last accepted, until the parent sends an update the rule agrees to. That is the trade, and it is why
this is an escape hatch rather than an optimisation to reach for.

**What a runaway does in production.** Two counters — `MAX_BUILDS_PER_DRAIN` and
`MAX_WORK_PER_FLUSH`, 100 000 each — are the only errors the framework raises in a production build
that can take a page down, and both are deliberate: a tab that stops responding is the worse outcome.
Now written down, with what each counts and what the message names.

**Two lazies that look the same.** `AsyncLoad`'s cache key defaults to the SOURCE of the `lazy`
function, so a factory — `const make = (path) => () => import(path)` — gives every module it builds
the same key. The first loads; the second never asks for its own and renders the first one's module.
Nothing fails and nothing is logged. Documented on the lazy page with the `cacheKey` that fixes it,
next to the route-table case where people meet it.
