---
"@ramonda/check": minor
"@ramonda/core": patch
---

`ramonda-check` reports a lens path that walks through a gap

Only the LAST hop of a `focusOn` path creates what it names. `focusOn(state).get("profile").set(p)`
writes a profile whether or not one was there; `focusOn(state).get("profile").get("name")` has to
walk through the profile to reach the name, and if `profile` is `null` there is nothing to walk. The
lens says so at runtime — `RML001`, which throws in development — and the new rule
`lens-path-through-a-gap` says it before the line runs.

The pair is the point. A path through a gap is written for the state as you picture it: a profile
that is loaded, an address that is filled in. The gap is the case you were not picturing — a fresh
account, a failed fetch, a first render — so the throw arrives on somebody else's machine while the
rule arrives on the line as you type it. TypeScript does not object either way, and that is not a
hole in the types: `keyof (Profile | null)` still offers `name`, so the chain type-checks because
the chain is legal. Whether the value is THERE is a question about the value.

A guard silences it, because a guard is what makes the write correct:

    if (state.profile) focusOn(state).get("profile").get("name").set("Ada");

The `if`, `!== null`, `!= null`, `&&`, a ternary and the early return all count, and the walk carries
on PAST a proven hop to whatever gap is deeper — found by planting, which is also how the six other
mechanisms in the rule were each shown to fail the suite when broken.

It reads DECLARATIONS, not types, because this package may not ask the compiler for one: the root
has to resolve to something with a written annotation, each hop's property has to be findable on an
interface or type literal, and "may be missing" is the annotation as written. An array index, a
computed key, a generic instantiation, an inferred root, or a `focusOn` that is not the lens's — each
stops the walk without a word. A warning, like every new rule here, and an error in a later version.

`importedFromCore` became `importedFromPackage` underneath, which is what lets the rule tell the
lens's `focusOn` from an app's own function of that name, alias and re-export included.

Four dead branches are gone, and one of them was hiding a real message

`@onWindow` and `@onDocument` resolved their target with a `typeof` check, and `Listener`'s `on:
"window"` did the same. An effect does not run on the server, so nothing could reach the empty side
of any of them — and `RMD041`, the diagnostic that reported it, was a section in the reference for a
fault the public API cannot produce. All of it is removed: the two resolvers answer the global, the
`Listener` hook's two words do too, and a resolver that CAN come up empty is still the hook's
`on: () => …`, whose `listen()` returns `false` and hands the caller something to act on.

`base/Context.ts` looked like a fifth case and was not. Two of its `holder` fallbacks are live, and
measuring said so: the RMD056 **throw** survives the production build while the name it prints is
DEV-only, so production reads "this component" — and a class expression assigned to nothing has a
`constructor.name` of `""`, which `??` does not catch. So `[RMD056]  mounts ThemeProvider twice`
went out with no subject and a double space where the subject had been. One helper now answers both
absences, every use is `||`, and two suites pin it: an unnamed class in the dev run, and the whole
message in the production one — where the context's `label` turns out to be stripped too, so the
report reads `Provider` rather than `ThemeProvider`.
