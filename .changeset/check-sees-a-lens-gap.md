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

Only a WRITE is reported. A read through a gap is what `value()` and `values()` are for — they
answer `undefined` and `[]` by design and raise nothing — so the chain has to end in `set`, `update`,
`merge`, `remove`, `and`, `push` or `insert` to be judged at all.

A guard silences it, because a guard is what makes the write correct:

    if (state.profile) focusOn(state).get("profile").get("name").set("Ada");

The shapes that count are the ones a guard is actually written in: the `if`, `!== null`, `!= null`,
`&&`, a ternary, the early return, `!!`, `Boolean(…)`, a `const` the value was read into, and a
longer path through the same hop (`state.profile?.name` can only be truthy if the profile is there).
Two boundaries are held deliberately and asserted: a COMPARISON through an optional chain proves
nothing, because `undefined !== null` is true when the value is missing, and a `let` can be
reassigned between the read and the guard.

An inverted guard is the fault at its clearest rather than an excuse for it: after
`if (state.profile) return;`, in the `else` of a presence check, and inside `if (!state.profile)`,
the gap is PROVEN — and each of those is reported.

The walk carries on PAST a proven hop to whatever gap is deeper. Every one of those mechanisms was
shown to fail the suite when broken, which is how three false alarms and four silences were found in
the first place.

It reads DECLARATIONS, not types, because this package may not ask the compiler for one: the root
has to resolve to something with a written annotation, each hop's property has to be findable on an
interface or type literal, and "may be missing" is the annotation as written. An array index, a
computed key, a generic instantiation, an inferred root, or a `focusOn` that is not the lens's — each
stops the walk without a word. It fails the run, like every rule here.

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
