---
"@ramonda/core": minor
"@ramonda/check": minor
---

A hook is made while its owner is made, and at no other time. `this.use()` on a component or hook whose
construction is over throws in every build, as RMD063 — from a method, `@created`, `@mounted`, a handler
or a callback. `ramonda-check` refuses every shape but a field's whole initializer, `name = this.use(…)`,
as the new `hook-used-outside-a-field`: a `use()` behind a condition, in a loop or in the constructor
body runs during construction and is reported before anything runs. Every owner then makes the same
hooks, once, in the same order, and a hook left off its owner's walk in production stays off it.
