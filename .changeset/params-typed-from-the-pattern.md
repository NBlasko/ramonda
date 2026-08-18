---
"@ramonda/router": minor
---

`params(pattern)` — the reading side typed from the pattern, and the pattern checked rather than trusted.

`route("/u/:id", { id })` has typed the WRITING side from the pattern since the kit existed;
`params<T>()` left the reading side as an annotation nobody verified. Now the type comes out of the
pattern:

```tsx
const { id } = this.route.params("/players/:id");   // id: string, nothing annotated
```

Same `ParamNames` machinery, pointed the other way. It moved to `match.ts` — the leaf both sides can
reach, since `createRouter` imports from `Router.tsx` and a type living there could not travel back.

**The pattern is constrained to the patterns YOUR table declares.** `Pat extends ParamPath<C>`, so a
route the table does not name is a type error and so is a static path, which has no params to read.
That is a step past inferring from a string the caller made up, and it is the reason the kit is bound
to one table at all.

**And it is checked at runtime, which is the part that matters.** A named pattern is a claim about which
route the component stands on, and an unchecked claim hands back `undefined` typed as `string`. Every
`:name` in the pattern must be present in what the outlet matched, and it throws otherwise — naming both
the pattern asked for and the route the component is actually on. It throws in every build, like
`route("/u/:id", {})` which has always refused to build `/u/undefined`: same package, same class of
mistake, same shape of message.

**Deliberately not an equality check on the route key.** A component rendered by both `/players/:id` and
`/users/:id` names one and is correct on both, because what it asked for is satisfied on both — the claim
is about the params, not the spelling. When two routes genuinely disagree, `params<T>()` is still there
and still the right door.

`ParamsContextValue` now carries the matched `key` alongside the params, which is what lets the message
say which route you are on. `matchCompiled` already computed it.

**Measured before it was designed.** Every parameterised route in this repository — three of them, all
with literal keys — and all six `params()` read sites had the same shape: one param, destructured
immediately, `params<{ id: string }>().id`. All six lose the annotation. The one route table built in a
loop (the docs site, 77 paths) has no params and reads none, so the case a computed key cannot type does
not arise there.

`TypedNavigator<P extends string>` is now `TypedNavigator<C extends RouteConfig>` — it needs the config
to constrain the pattern, and it derives the href union from it as before.
