---
"@ramonda/core": minor
"@ramonda/check": minor
---

**A `@compute` method is now a method.** Both forms are real, and each is typed as what it installs:

```tsx
@compute get total() { … }   // this.total    — an accessor, so it IS the value
@compute total() { … }       // this.total()  — a function that returns the value
```

Before this, a method had an **accessor** installed, so the member was declared `() => R` while it held an
`R`. That is a type lie in both directions, and both were measured: reading it as the value it is was a
type error, and calling it — which the type allowed — threw `total is not a function`. The
`alternatives` block on `/concepts/compute` taught the call.

So the choice between a getter and a method is a real one again, and the `get` is not ceremony: it decides
how you read the value, and both readings are true. One cache, one set of dependencies, one invalidation —
measured: each form runs its body once for two reads, and once more after a write.

**And neither form takes an argument, refused in three places** — the type first, then the two nets behind
it. A `@compute` caches one value per
component, so there is no key: an argument would be accepted and ignored, and the second call with a
different argument would hand back the first call's answer — a wrong number, silently.

- The framework throws when the class definition runs, **in every build** rather than in development only,
  because the failure is a wrong value rather than a slower one.
- `@ramonda/check` reports it before the build, as the new **`compute-takes-no-arguments`** rule, at error
  severity. The class definition running is the first import of the module, so a component behind a route
  nobody opened would otherwise ship with the fault and throw for whoever opens that route.
- The **type** refuses it first, and that is the earliest net: a function declaring a parameter is not
  assignable to one that declares none, so `compute`'s own `(this: T) => R` is enough — measured,
  `@compute withArg(k: number)` is `TS1241`. The rule and the runtime are for a project with no types, a
  `@ts-ignore`, or a cast.

`@memoized` is the decorator keyed BY arguments, and every one of the three messages says so.
