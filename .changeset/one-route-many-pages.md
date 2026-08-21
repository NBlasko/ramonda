---
"@ramonda/router": minor
---

An ISR route can take a `:param`, and the cache it fills is bounded.

`revalidate` on `/products/:id` was accepted and did nothing. `plan.isr` carried the PATTERN, and
`createIsrCache` keyed its window map by that string and looked it up exactly — so `serve("/products/7")`
found no window, returned `undefined`, and the caller fell through to its dynamic branch. The page then
rendered per request with the REAL request context: no shared cache, which is the opposite of what
`revalidate` asks for, and nothing said so. Measured before the fix.

`serve` matches the pattern now, and each page is cached under its own path. A LITERAL route is asked
first, so `/products/new` beside `/products/:id` is the page somebody wrote rather than an id called
"new".

**And one route is now as many pages as there are items, so it needs a limit.** `maxPages` is
**required** when any ISR route takes a `:param`, and refused when none does — a number that bounds
nothing is a number somebody will trust. Without it, one crawler walking `/products/1`…`/products/100000`
fills the store with pages nobody asked for.

**The eviction is least RECENTLY asked for, not fewest hits**, and the intuitive rule is the wrong one:
counts accumulate, so a product that was popular last week keeps its ten thousand while one that went
viral an hour ago has three — and a brand new entry always has the fewest, so it would always be the
first thrown out. Fixing that needs decaying counters, which needs a clock, which needs a test that
depends on one. Recency adapts by itself and is a `delete`-then-`set` on a hit plus one `keys().next()`
on an eviction, because a `Map` iterates in insertion order.

The TTL is why the policy matters less than the cap: every entry dies after `revalidate` seconds anyway,
so this never chooses between a fresh page and an ancient one — the bound is protection from BREADTH in
a single window.

**`IsrStore` gains `delete`**, because eviction cannot be expressed without it. A custom store must add
one method; `memoryStore` and `fileStore` have it, and `fileStore` treats a missing file as success — an
eviction that cannot happen must not turn a served page into a 500, and the entry expires on its own.

Two prose claims that had gone false are corrected with it: `memoryStore` said it "cannot grow on its
own" (true only while a route meant one page), and two server templates said `IsrStore` is two methods.

**The cap is only as good as the count behind it, and that count is a map this process keeps beside a
store it does not own.** Everything below is one of the two being made to agree with the other, and
every case was measured.

- Recency is recorded only for a page the store holds NOW. Recorded on the way in instead, a cold
  render that rejected left a key with nothing behind it and the cap counted the phantom: with
  `maxPages: 2`, one failed render made the next success drop BOTH live pages.
- The trim runs after every answer, not only after a bake. Only-after-a-bake leaves a store this
  process did not fill unbounded — a `fileStore` directory after a restart: five seeded entries,
  `maxPages: 2`, five hits, nothing dropped.
- A bake records its page beside the WRITE. The stale path trims before starting a rebake, so an entry
  evicted mid-rebake is written back into the store, and the count has to learn about it there or
  nothing can ever reach it again.
- An eviction never fails an answer, and never leaves an orphan either. The store is dropped BEFORE the
  key is forgotten, `onError` hears about a `delete` that rejects, and the page is still served — a
  cache one entry too large is a page the visitor gets, a 500 is not. A failed delete also moves its key
  to the back and ends the pass: left oldest, it is what every later trim picks and fails on, and a
  single un-deletable key let a store grow to thirty entries under a cap of two.

**A `store.delete` is a round trip, and the cache holds the keys inside one.** That set answers all
three questions the wait raises. A key in it is not COUNTED, because a page whose deletion is committed
is not a page the cache holds — counting it makes a concurrent trim evict one live page too many, and
under `maxPages: 1` left the cache holding zero. A key in it is not PICKED, so a pass evicts the page it
meant to. And a write REMOVES its key from it, which is how the reply can tell what happened while it
travelled: a key still in the set saw only reads, so the entry is gone and the key goes with it; a key
already out of it was rebuilt, and keeping it is what stops that new entry being orphaned.

Planted nine ways, and eight of the plants fail a test. The ninth — evicting a key another pass is
already deleting — costs a duplicate `delete` and a moment over the cap, and changes which pages
survive not at all; it says so where it is written.

`onError` receives eviction failures as well as rebakes now, so its contract says so, its default line
says "background work" rather than "rebake", and an eviction is reported against the page it could not
drop with the operation named and the reason in the `cause`. `IsrStore`'s own docstring, `fileStore`'s,
the `redisStore` example on the modes page and the preamble it type-checks against all said two methods;
the example would have thrown `store.delete is not a function` at the first eviction, and `guarded`
would have swallowed it.
