---
"@ramonda/router": patch
---

Test only: `serve`'s two `touch` calls, with the eviction in view

The one part of the ISR module a review had not seen in its current form. `touch` records recency
and deliberately does not uncondemn — a read stores nothing, so a key on its way out stays on its
way out — and the window that describes is real: a `store.delete` in flight, the entry still there,
and a request for exactly that page.

The read path is correct and now says so. The request is served, and the count is left honest: the
next insert evicts exactly one page. A key touched into the count and then deleted from the store
without leaving the count would be a phantom, and the cost of one is a live page evicted early.

**The stale path costs more than the note about it said.** Serving a stale page starts a rebake, and
when that lands inside the eviction the delete removes what it had just written — known, accepted,
one page re-rendered later. What was not written down is that the write uncondemns the key, so it
stays in the count with nothing behind it, and the NEXT insert is two over the cap: it evicts twice,
and the second is a live page. The cache ends holding one page under a cap of two. It heals, and the
healing costs a page that had done nothing wrong.

Written down as the measured cost rather than fixed: the fix needs compare-and-set in `IsrStore`,
which turns three unconditional methods into an interface most stores cannot satisfy.
