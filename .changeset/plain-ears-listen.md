---
"@ramonda/check": minor
---

New rule: `listener-added-by-hand` — a component reaching for `window.addEventListener` itself.

`@onWindow` and `@onDocument` attach on mount and detach on unmount, and there is nothing to
remember. A hand-rolled listener has to be removed by hand, and one that is not outlives the
component that added it: the handler keeps running, reading state nobody is showing and holding the
component and everything it closed over alive. Open and close the same view ten times and there are
ten of them.

Nothing reported this before — measured, a component calling `window.addEventListener` in `@created`
AND in `render()` produced no findings at all, and no rule in the package mentioned
`addEventListener`. The harm was measured against the real runtime rather than argued: a listener
registered in a `render()` is **6 listeners over 6 renders**, none removed. The report says which
member it is in for that reason.

Removing the listener by hand is not an answer to this and neither is `{ once: true }`: the
decorator takes the same options and does both halves. That is where this differs from
`interval-with-no-cleanup`, which accepts a raw timer paired with a `clearInterval` — a timer has
shapes `@interval` does not cover, and a listener does not.

**The one place a decorator genuinely cannot be used is `if (__DEV__)`, and that is the escape.** A
decorator is code on the CLASS, so no guard can remove it: a dev-only listener written with
`@onWindow` would attach in production too, on every mount, for an event nothing dispatches.
Verified in `packages/query/dist/index.prod.js`, where the methods that add and remove one compile
to `publishToDevtools(){}` and the listener does not exist — while `@onWindow("online")` on the
`Query` hook is plainly there in the same file. `@ramonda/query` and `@ramonda/form` both need this,
and both already say so in their own source.

So inside a `__DEV__` guard the hand-rolled call is right, and the only question left is the
ordinary one: does anything remove it. A `||` is not a guard, and the `else` of one is the
production half; neither counts.

**The escape is a fact rather than a promise**, which is deliberate and matters beyond this rule: a
`ramonda-check-ignore` is the author's claim about a line and can be written anywhere, while a
`__DEV__` block can only be got by making the code really vanish from the build. `rules/dev-guard.ts`
carries that reasoning and is available to any rule that needs it.

Also silent: a listener on anything that is not `window` or `document` — an `AbortSignal` dies with
its request and an element with the element, and no decorator covers either — and module scope,
which lives as long as the module.

A warning today and an error in a later version. Nothing in this repository trips it, with the
silence on `@ramonda/form` proved to be earned rather than accidental by taking its `__DEV__` guard
away and watching the rule report it.
