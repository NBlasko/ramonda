---
"@ramonda/core": minor
---

New DEV diagnostic: `RMD020` — development builds render every component **twice** and report what came out different.

With no state change between the two calls, anything that differs was built by the render itself, or does not come from state at all. Three things get named, each with its own fix:

- **a function built in place** — the source is identical, only the identity is fresh. An event handler whose identity changed is removed and re-added on the element every render; a function passed to a child re-renders that child. `@memoizedHandler` returns the same function for the same arguments, so it reads as stable.
- **an object or array built in place**, with equal contents — a child re-renders, a `@compute` recomputes, and if it is a list's items every row loses its identity and the whole list is rebuilt.
- **a value that is not a function of state** — `Date.now()`, `Math.random()`. The same mistake RMD007 reports after a hydration mismatch, caught here without needing a server render to disagree with.

**Why twice rather than comparing against the previous render:** that comparison cannot tell "created in place" from "genuinely changed". Two calls in one tick can, with no false positives.

**Why every render:** measured, `render()` is 3-4% of a commit — and 0.04% for a table of 500 rows, because `list()` is lazy, so a second render rebuilds the descriptor and not the items. Checking only the first render would miss every branch not taken then, which is where handlers live.

The check also covers a hook's props callback, the other place values are built per render: a bag rebuilt with equal contents fires every key's signal, so an `@effect`, a `connect` or a `@compute` reading it re-runs on every render of the owner.

**One thing to expect:** a `render()` with a side effect performs it twice in development. RMD001 already makes a state write there an error, so "render is pure" is the rule either way — but a `console.log` in a render really will appear twice. Production strips the check entirely (verified: no `RMD020` and no symbol from the module survives in the prod bundle).
