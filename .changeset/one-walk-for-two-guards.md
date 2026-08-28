---
"@ramonda/check": minor
---

A dev guard is recognised in two more shapes, and both guard walks became one

`insideADevGuard` decides whether dev-only code is dev-only, and `listener-added-by-hand` is what
asks it. Two shapes were missing, and both made that rule report **correctly guarded code** —
telling its author to reach for a decorator, which cannot be made dev-only at all:

- `if (!__DEV__) return;` and everything after it. The early return is how a `render()` is written
  far more often than a nested `if`.
- `if (import.meta.env.DEV)`. `__DEV__` is the spelling this repository asks for and documents, and
  it is not the only one available — a bundler provides `import.meta.env.DEV` itself, and somebody
  arriving from one reaches for it without thinking. Reporting their working code over a second
  spelling is worse than tolerating the second spelling. `guardsDev` is shared, so
  `dev-guard-as-an-expression` now asks for the `if` form of that one too.

**And the two guard walks became one.** `side-guard.ts` shipped an hour earlier with its own copy,
on the stated argument that a dev guard never needs an early return because dev-only code goes
INSIDE its guard. That was wrong within the hour — measured on a plant, the early return was exactly
what `insideADevGuard` was silent on. The shapes now live in `guard-walk.ts`; each file only says
what its own CONDITIONS mean.

It takes two predicates rather than one and a negation, deliberately: a condition can say three
things — this, the opposite of this, or nothing — and inverting one predicate would read every
unrecognised condition as proof of the opposite.
