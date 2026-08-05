---
"@ramonda/check": minor
"create-ramonda": patch
"@ramonda/query": patch
---

`@ramonda/check` finds class fields holding a function literal, and its bin is now `ramonda-check`

Ramonda binds every method to its instance, so `onPick = (id) => this.select(id)` buys nothing over
`onPick(id) { … }` and costs one closure per instance. The check reports each one, and says which of
the two fixes applies: a body that reads `this` wants to be a method, a body that does not wants to
leave the class.

It reads the source because nothing else can. At runtime the two are indistinguishable — by the time
anything could look, the framework has written a bound function onto the instance under every
method's name, and a field holding `debounce(this.save, 200)` is a function there too. That one is
legitimate: a wrapper cannot be written as a method. Only the source tells a function literal from a
call that returns one. `static` fields are not reported either — one per class, so nothing to save.

**The bin is renamed** from `ramonda-check-context` to `ramonda-check`, because it no longer checks
only contexts. Update the `build` script: `ramonda-check && …`. `npm create ramonda` writes the new
name.

`@ramonda/query` had one of these itself — `Query.observe` was an arrow field and is now a method.
