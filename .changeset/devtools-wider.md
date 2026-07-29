---
"@ramonda/devtools": patch
---

The drawer is twice as wide: `min(900px, 92vw)` instead of a fixed `450px`.

450px was set before the panel had a component tree with nested state blocks and a query table
with keys, statuses and data previews in it — both of which are wide, and both of which were
wrapping into unreadable columns.

Capped at `92vw` so it cannot swallow a narrow window, which a flat `900px` would.
