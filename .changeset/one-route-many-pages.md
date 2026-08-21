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

**Three faults in the bookkeeping, all found by review and each measured before the fix.** The cap is
only as good as the count behind it, and the count is a map this process keeps beside a store it does not
own — all three were that map saying something the store does not.

- Recency was recorded BEFORE the read, for every request, so a cold render that rejected left a key
  with nothing behind it and the cap counted the phantom: with `maxPages: 2`, one failed render made the
  next success drop BOTH live pages. It is recorded only for a page the store holds now.
- The trim ran only after a bake, so a store this process did not fill — a `fileStore` directory after a
  restart — was never bounded at all: five seeded entries, `maxPages: 2`, five hits, nothing dropped.
  It runs after every answer.
- The eviction was unguarded on the cold path, so a store whose `delete` rejects turned a page that had
  rendered AND stored into a 500. An eviction that cannot happen is a cache one entry too large, which
  the next request tries again.

Planted seven ways, and two of the plants found missing COVERAGE rather than a fault: the trim on the
stale path and the guard on the hit path were untested, because the first tests reached only the other
two branches. Both are covered now.

**A second review of that fix found two more of the same class, and both are in the ordering.** The trim
forgot a key BEFORE awaiting `store.delete`, so a rejected delete left the page in the store with nothing
pointing at it — permanently, which made the sentence "the next request tries again" false; the store is
dropped first now. And the stale path trims before starting a rebake while `bake`'s write recorded
nothing, so an entry evicted mid-rebake was written back into a store the count no longer knew about;
recency is recorded beside the write, so a landing rebake re-registers itself.

`onError` receives eviction failures as well as rebakes now, so its contract says so, its default line
says "background work" rather than "rebake", and an eviction is reported against the page it could not
drop with the operation named and the reason in the `cause`. `IsrStore`'s own docstring, `fileStore`'s,
the `redisStore` example on the modes page and the preamble it type-checks against all said two methods;
the example would have thrown `store.delete is not a function` at the first eviction, and `guarded`
would have swallowed it.
