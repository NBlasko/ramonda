---
"@ramonda/core": minor
"@ramonda/form": patch
---

A hook's props are a callback. The plain-object form is refused, in every build.

`this.use(Counter, { start: this.count })` reads as if it passes `count`, and it does — once. A field
initializer runs while the owner is being constructed, so the object holds what was true at that
moment and holds it for the life of the hook. Measured with `{ seed: this.n }` and `n` moved 1 → 7:
the hook reads **1** forever, the callback form reads **7**, the owner reads **7**, and nothing
reported the difference.

Nothing could report it. `use()` is handed a finished object with no way to tell `{ seed: this.n }`
from `{ seed: 1 }`, so no runtime check exists that is not a heuristic — which leaves the FORM as the
only visible half, and the form is now what the framework holds you to. `@ramonda/check` cannot cover
for it either: a value reaching the bag through a helper or a build with no types is past what any
static rule sees.

**The migration is `() => ({ … })`,** and it costs nothing where the object looked cheapest. A
callback that reads no signal is called **once, at mount, and never again**, and the inline functions
in it keep their identity across every render of the owner — so a bag of constants and closures
(`fetch`, `retryDelay`) is built exactly as many times as the object was, with no churn for RMD022 to
report. `core/__tests__/PropsBagRuns.test.tsx` pins both halves, and the mirror beside them: a bag
that DOES read a signal re-runs, with fresh functions each time, which is what `@StableProps` is for.

**It throws rather than warns,** the same rule as a write to props (RMD004, RMD015), and outside
`if (__DEV__)` so a shipped bundle cannot go on serving one stale value for the life of the page.
Development adds the explanation and a record naming the owner, the hook and the keys the object
carried; production carries the code and one sentence. Production core grows **63 bytes gzipped**
(23,609 → 23,672; raw +334), and `apps/docs`'s production-build tripwire now names `RMD055` among
the codes a production bundle may carry.

The types refuse it first: the `props: Q` overload is gone from `Component.use` and `Hook.use`, so the
mistake is a compile error before it is ever a thrown one.

`RMD055` is the code, on [the diagnostics reference](https://ramonda.pages.dev/reference/diagnostics#rmd055-a-hooks-props-passed-as-a-plain-object).

**126 call sites moved** across this repository — 9 in the example apps, 95 in tests, the rest in
documentation and JSDoc. Two comments went with them: both defended the object form with churn a
callback would supposedly cause, and neither was true, since a bag that reads no signal is not
rebuilt.
