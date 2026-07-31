---
"@ramonda/testing-library": patch
---

`await act(async () => …)` is typed as a promise again.

Reported as an editor complaint on `await settle()` — *"'await' has no effect on the type of this
expression"* — and it was right. `act`'s sync overload was declared first, and a `() => void` parameter
accepts a function returning **anything** (that is what `void` means in a return position), so
`act(async () => {})` matched it and typed as `void`.

Nothing misbehaved at runtime: the implementation looks at what came back rather than at what was
declared, and every existing test passed both before and after. The cost was a false hint on every
`await act(…)` in every repo using it, which is the kind of noise that teaches people to ignore hints.

The promise overload comes first now, and there is a type assertion holding it — enforced by
`check-types` rather than by the test run, since `expectTypeOf` compiles to nothing. Verified by putting
the old order back: `vitest run` still reports every test passing, and `tsc --noEmit` fails.
