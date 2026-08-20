---
"@ramonda/core": patch
---

`/concepts/compute` taught a line that throws.

The "getter or a method" block read `total() {} // this.total()` — a call. Measured: `@compute` installs an
accessor, so a method stops being callable. `this.total` holds the value; `this.total()` throws
`total is not a function`.

**Nothing caught it because the claim was in a comment.** `check-examples` compiles the code in a block,
and `// this.total()` is prose. The page now says both forms are read as a property, and why: the method
form is a spelling, not a different kind of thing.

It also says what follows from that, which was the missing half — a `@compute` method takes no parameters
because nothing would ever pass one, and `@memoized` is the decorator keyed by arguments.

Pinned in `DecoratorValidation.test.tsx`: the property holds the value, and calling it throws.
`/concepts/caching` shows both forms too — it had the method form in one table cell while every example was
a getter, which is how a reader concludes the getter is the only shape.
