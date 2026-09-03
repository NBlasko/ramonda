---
"@ramonda/core": patch
"@ramonda/query": patch
---

Every message names its component, even when the class has no name

A class expression assigned to nothing has a `constructor` whose `name` is the empty string — a
factory that returns a class, an anonymous default export, a class built inline. Read bare and
interpolated, that prints a message with no subject.

Twenty-nine sites did exactly that, across `renderPhase`, `updateRules`, `timerGuard`,
`computeChurn`, `renderStability`, `lifecycleMenagement`, `common`, `hydrate`, `Task`, `Component`,
`Hook` and `decorators` — so `RMD004`, `RMD015`, `RMD006`, `RMD008`, `RMD009`, `RMD021`, `RMD030`,
`RMD055` and the hydration family could each arrive with nothing where the component should be. All
of them go through `displayName` now, which answers `"Unknown"` for an empty name and for an
instance with no `constructor` at all. `@ramonda/query`'s missing-provider error took the same fix at
the one place it is printed.

**The sweep that was supposed to have done this missed them, and that is why there is now a gate.**
The earlier pass fixed the sites carrying an explicit fallback by grepping for `??` and `||`; a site
with no fallback matches neither, so twenty-nine survived and one was found by accident three days
later while reading an unrelated function. `scripts/check-nameless-class.mjs` greps for the READ
instead, and fails on a new one. A read that is COMPARED rather than printed, or already answered by
`?? "…"` / `|| "…"`, is not a subject and needs no exception — which leaves the table at one entry.

Two of the messages are pinned by tests and the rest cannot be, for a reason worth knowing: a class
expression with a DECORATED member is named by the transpiler, so anything needing `@state` or
`@created` to fire never sees an empty name. The two that need no decorator are the two that THROW.
