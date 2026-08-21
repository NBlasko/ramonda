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

Planted three ways: patterns not matched at all, the LRU degraded to insertion order (caught only by the
test that asks for a page twice), and the literal route losing to the pattern.
