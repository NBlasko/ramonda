---
"@ramonda/core": minor
---

New DEV diagnostic: `RMD021` — randomness generated during a `render()`, a `@compute`, a `@memoizedHandler` builder, or a hook's props callback.

`Math.random`, `crypto.randomUUID` and `crypto.getRandomValues` are patched in development (the trick `timerGuard` already uses for timers) and report when called while one of the four pure phases is running. Four messages, because the same call fails differently in each place:

- **render** — the output depends on when it ran, so a server render and its hydration disagree (RMD007).
- **`@compute`** — quieter and worse: the answer is cached, so the value is frozen until a dependency the compute actually READ changes, which may be never.
- **memoised handler** — the value is cached *with* the handler, so every call uses the same one. The builder runs during a render, so without its own phase marker the report would have named the render and pointed at the wrong fix.
- **a hook's props callback** — the sharpest of the four: the callback runs on every render, so the prop holds a different value each time. As a query key that is a new cache entry per render and a fetch that never settles. This is also why the callback does NOT run twice in a strict render — watching the call catches the same mistake, and a callback may do more than build an object.

**Why it exists next to RMD020.** The double render finds non-determinism only when the two calls differ. Measured over 200,000 tries: `Math.random()` and `performance.now()` differ every time, `new Date()` differs every time (a fresh object), and **`Date.now()` differs in 0.006%** — the two renders are microseconds apart, inside one millisecond. So the double render is blind to a millisecond clock.

**Why the clock is still not patched.** That was the first version and it was wrong: a patched global catches the *platform's* calls too. An `Event` constructor stamps `timeStamp`, which under jsdom is a JS-visible `Date.now()` — so raising any diagnostic during a render tripped it, and three of core's own tests began failing with RMD021 instead of the code they asserted. Under jsdom is where every app runs its own tests, which makes that disqualifying rather than fixable. Randomness has no such problem: nothing in the platform generates it behind your back.

The docs now carry the full inventory of non-deterministic reads and which check covers each — including the one gap neither covers: `Date.now()` in a client-only app, rendered into the output.
