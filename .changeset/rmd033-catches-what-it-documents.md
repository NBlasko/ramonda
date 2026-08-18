---
"@ramonda/core": minor
---

`RMD033` now catches what it has always said it catches.

Its `fix` text reads: "a function, a class instance, a **Map** or a **Date** is lost on the way".
The implementation was a `try`/`catch` around `JSON.stringify`, which only ever sees a THROW — and
none of those throw. Measured by round-tripping every common type through the hydration blob:

```
new Map([["k", 7]])  ->  "{}"            every entry gone
new Set([1, 2])      ->  "{}"            every entry gone
new Date(0)          ->  "1970-01-…"     a string, so .getTime() throws on the client
```

All three crossed **silently**, with no diagnostic at all, and the page then failed later with a
`TypeError` on a method the value no longer had. A `Date` in state is not an exotic case; it is the
ordinary shape of a created-at field.

The check now asks about the SHAPE rather than matching a list of types: anything that is not a
plain object, an array or a primitive comes back from the blob without its prototype and usually
without its contents. That covers `Map`, `Set`, `Date`, `RegExp`, `URL` and any class instance,
including the ones nobody thought to list. It recurses, bounded, because the commonest shape of all
is a plain object holding one — `{ createdAt: new Date() }` travels as an object whose date has
quietly become a string.

No new diagnostic code: `RMD033` already meant this. Development-only, on the serializer's
once-per-render path rather than the per-write one.
