---
"@ramonda/core": patch
---

`@compute` refuses a method that declares a parameter, in the build that has no types.

A typed build already refuses it — `compute`'s target is `(this: T) => R`, so a parameter is `TS1241` —
and that half is now pinned in `__tests__/DecoratorTypeClaims.tsx`. Bypass the type and it was silent:
measured under vitest, which transpiles rather than checks, `@compute times(n: number)` left `this.times`
holding **`NaN`**, with the body run once for `n === undefined`. `@compute` on a method installs an
accessor, so nothing was ever going to pass an argument.

It says which decorator does take one, because that is the line between the two: **`@compute` is keyed by
nothing, `@memoized` is keyed by its arguments.** The parameter list is where they are told apart, and
asking whether the two names collide is what turned this up.
