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

**Not** a hook's props callback, and that is a decision the audit made rather than an omission: the callback exists in order to re-run per owner render, so the bag and the closures inside it are fresh by design (a fetcher closing over a prop cannot be stable). Reporting them was a warning per hook with nothing to do about it. A vnode passed as a prop is walked rather than reported, for the same reason at a smaller scale — JSX is a fresh object every render, and what still counts is an inline handler inside it.

**One thing to expect:** a `render()` with a side effect performs it twice in development. RMD001 already makes a state write there an error, so "render is pure" is the rule either way — but a `console.log` in a render really will appear twice. Production strips the check entirely (verified: no `RMD020` and no symbol from the module survives in the prod bundle).
