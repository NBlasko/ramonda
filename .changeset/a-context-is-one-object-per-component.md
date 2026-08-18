---
"@ramonda/core": patch
---

The `Context` type says what a context is, and the object two publishers share is under a gate.

`Context` was declared `Record<string | number, State<any>>`. Nothing has stored a `State` there
since a context became one signal per key, and one of its two publishers keys by a symbol, which
that declaration does not even permit — so both of them cast their way past it, and a cast is what
lets one place quietly break the other. It is now `Record<string | number | symbol, unknown>`, and
the invariant lives on it in one place: a component's object is created FROM its parent's, so a read
walks up to the nearest ancestor that published; a publish lands as an OWN property, so a sibling
reading the same ancestor never sees it. Two casts deleted, one `State<any>` gone, and the
`Object.create` in `createComponent` typed instead of `any`. Every read keeps its cast, which is the
publisher naming the shape it published.

No helper was added. What both publishers do is `context[key]` and `context[key] = value`, and a
function around either is a call-site wrapper — the honest type is what makes them safe, not a
second way to spell them.

**Measured by breaking it on purpose.** Replacing `Object.create(parentContext || null)` with the
parent's own object — the change anyone would make to save an allocation — failed **2 of core's 1116
tests, both about `Head`**; the same break in the hydration creator failed **none of the 1121**. So
the context half of the mechanism was unguarded in both places and the hydration half entirely.
`ContextIsOnePerComponent.test.tsx` holds six cases for the two publishers together — sibling
isolation, the chain across wrappers a provider does not sit on, the nearer provider shadowing for
its own branch only, a change still arriving down the chain, a `Head` and a context sharing one
object undisturbed, and the same isolation after a real server render and hydration. Against those
breaks it now fails 3 of 6 and 1 of 6.

Behaviour is unchanged: 1121 of core's tests pass before and after.
