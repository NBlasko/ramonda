---
"@ramonda/core": patch
---

Test only: `ErrorBoundary` around the shapes a slot and a list build

Queue item 5. A throw from a displaced slot is caught by the nearest boundary above where the slot
LANDED — the same rule context follows, and the one that decides a slot's lifecycle and depth.
Asserted from all three sides, including the case that looks like the exception: the writer's
boundary catches when the writer is what rendered the landing component, which puts it on that path.

Also pinned: how much a boundary takes with it (outside a slot it replaces the slot and its host,
per row it replaces the row), that a module which throws while RENDERING goes to the boundary rather
than to `AsyncLoad`'s `errorFallback` — those are different failures and only one of them is the
loader's — and that `reset` sends a boundary back to its children.

No behaviour changed. Planting a walk that skips the nearest boundary fails all seven.
