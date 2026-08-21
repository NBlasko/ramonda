---
"@ramonda/check": minor
---

New rule: `dev-guard-as-an-expression` — a `__DEV__` guard written as `&&` or `?:` where an `if`
would do the same thing.

**Not a dead-code rule, and the measurement is the reason it says so out loud.** With esbuild and
`__DEV__: false`, the `&&` form is DROPPED where an unminified `if (false) { … }` keeps its whole
block and its string literals; with `minify: true` — which every package here uses — both vanish
identically. Whoever reaches for the operator to help the bundler is not helping it.

The `if` is asked for because a flag with two spellings has to be read twice by everything that
reads it, and this repository has already paid for that: `dev-guard.ts` was written against the `if`
alone, so `listener-added-by-hand` reported dev-only code for being written the other way.

**Only where an `if` is a REPLACEMENT.** A statement, and nothing else — `const name = __DEV__ ?
displayName(x) : ""` uses the value and an `if` produces none, so it is left alone. Five of those
are written here, in `core` and `lens`. And `if (__DEV__ && ready)` is a conjunction inside the
`if`, which is the shape being asked for rather than an instance of the fault; 149 of those are
written here.

A warning today and an error in a later version. Zero findings across every project in this
repository — measured, and in this case that is the whole population: the statement form is written
nowhere.
