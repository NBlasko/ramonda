---
"@ramonda/core": patch
---

Two branches neither test run had ever taken

The union of the development and production coverage named them, and they turned out to be different
faults wearing the same shape.

**`createRef` had no production coverage at all.** `base/Ref.ts`'s `if (__DEV__)
reportRefBuiltInAPurePhase()` was taken 61 times in the development run and zero in the production
one, so nothing had ever asked what the shipped ref factory does. It builds the ref and says nothing,
which is deliberate: a ref built in a render is a new identity every time and costs the child a
render it did not need — a real fault, and one that still renders correctly, so taking a page down
over it in production would be worse.

The test asserts that promise where it can actually fail. Planting the guard away fails nothing,
because the reporter asks `purePhase()` first and that answers `undefined` in a shipped build —
`renderPhase.component = component` is itself inside `if (__DEV__)` in `generateRenderOutput`. So the
mechanism that enforces silence is the unmarked render phase, and moving that assignment outside its
guard is what fails the test. It also breaks the ref callback, because the `finally` that clears the
mark is inside the same guard: a production build would read as rendering forever.

**`configureDev` had never been called with a flag it does not mention**, which is what every caller
will do the day a second flag exists. `if (flags.strictRender !== undefined)` had 405 calls on its
true side and none on its false one, in either run. It is asserted from both starting values, because
"unchanged" is only a claim if it can be told from "assigned a constant" — a body writing `true`
unconditionally passes the first of the two.

That one is a development test, and the correction is part of the finding: the `if (!__DEV__)` guard
above it was already covered from both sides, 405 in development and 12 in production, because
`vitest.prod.config.ts` uses the same `src/test/setup.ts` and that file calls `configureDev`. The
production side of that function was never the gap.

Measured after: `config.ts` line 55's false side is at 2, `Ref.ts` line 44's false side at 4, and
`Ref.ts`'s `setCurrent` early return picked up production coverage on the way. Files with every
branch taken by one run or the other: 30 of 83, from 28.
