---
"@ramonda/core": patch
---

`RMD045` — two `@Host` on one class, said in words and reported to a collector

It always failed, with V8's own message: `Cannot redefine property: Symbol(host:meta)`. `HOST_META` is
written non-configurable, so the second `defineProperty` threw — naming an internal symbol, offering no
advice, and pointing inside `decorators.ts` rather than at the class. For a mistake as easy as writing the
decorator twice, that was the worst report available.

It now throws with a sentence that says what to do, and **emits a record as well**. Those are not
alternatives: the throw is the developer's channel and ships in every build, while the record is what an
app streaming its diagnostics somewhere needs in order to see this alongside everything else it has to
tidy up. A fault that only throws is invisible to that.

What decides whether a fault also throws is whether the program can carry on. `RMD032` and
`RMD040` report and continue, because one declaration quietly wins; a component cannot have two elements,
so there is no winner to pick here.

A **subclass** declaring its own `@Host` is not this. It overrides the base's — how a specialised
component changes its element — and stays silent.
