---
"@ramonda/core": minor
---

A page that has not moved ships no hydration state.

A field still holding the primitive its own initializer produced is left out of the blob. The
browser runs the same initializer and arrives at the same value, so writing it down was bytes for
nothing — and a component whose whole tree carries nothing now gets no `data-ramonda-state`
attribute at all.

What it was costing, measured on `@ramonda/form`'s five-row SSR page: **942 of 1935 bytes** were
hydration state, and nearly all of it was `{"version":0}` — the subscription counter every watched
component carries, always zero on the server, because a `@state` counter is the only thing that
attaches the owning component's rebuild and `@state` MEANS "serialize me". At 300 rows that was
around 17 KB of markup saying nothing.

After: **985 bytes and zero blobs** on that page, and the SSR playground's own `/` went from 13488
to 12704 bytes. The framework pays 239 bytes gzipped once (22544 → 22783); every server-rendered
page collects.

**Primitives only, and that bound is correctness rather than thrift.** An in-place mutation keeps
the very object the initializer produced, so an identity test on an object would call a filled value
untouched and hand the client an empty one — measured, `this.rows.push(…)` does reach the blob
today, RMD005 and all. A primitive has no in-place to mutate.

**A field the server EMPTIES now travels as such.** This was already broken and is fixed here:
`JSON.stringify({ name: undefined })` is `{}`, so a field cleared on the server was indistinguishable
from one never touched, and the browser's own initializer put the old value back — a signed-out
visitor got the signed-in name. Cleared keys ride in their own list on the node and are applied on
restore, through the same declared-keys filter every other restored value passes, so a tampered blob
still cannot name a property the instance never declared. `null` is untouched and deliberately not
folded in: JSON carries it, and conflating the two would make an explicit `null` unrepresentable.

**What this does break is already documented as a mistake.** A non-deterministic primitive
initializer — `@state now = Date.now()` — used to survive because the blob carried the server's
number; measured, 101 on the server now becomes 103 after hydration. `/ssr/mismatches` already marks
that spelling wrong and prescribes computing in `@created({ env: "server" })`, and that prescription
is untouched, because a computed value is not the one the initializer produced. The page now says
why the blob does not rescue it.

Four faults planted, and the fourth is the one worth carrying. Removing the primitives-only guard
was NOT caught at first: `mutationGuard` hands out a proxy in development, so `this.rows` never
matched the raw array and the identity test could not fire — the test passed while the fault would
have shipped to production, where there is no proxy. The test uses a class instance instead, which
the guard leaves alone, so identity is the same on both sides.

The tests that asserted the old format were rewritten to write their values first rather than to
expect the smaller blob: a suite that asserted `{}` everywhere would pass just as well if
serialization stopped working.
