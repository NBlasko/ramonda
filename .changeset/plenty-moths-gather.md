---
"@ramonda/lens": minor
---

`push` and `insert` write into an array that is not there yet, and three keys are refused

Two changes to behaviour, plus documentation for a trap the sharing guarantee carries with it.

**`push` and `insert` create the array.** `set` already created a missing key, because `tags?:
string[]` is a type TypeScript accepts and refusing it at runtime made the API disagree with its
own types. `push` on that same missing key warned and did nothing — so the two spellings of one
intent disagreed, and the type system offered both:

```ts
focusOn(state).get("post").get("tags").set(["a"]); // created it
focusOn(state).get("post").get("tags").push("a"); // did nothing
```

Both land now. A missing or `null` value counts as an empty array; a value that IS there and is
not an array is still reported and still changes nothing. `push()` with no items stays a no-op
rather than minting an empty array, so a write that changes nothing still returns the original
root.

`merge` deliberately does not create, and the line between them is what the operation can
supply: `push` hands over a complete array, while `merge` has only a `Partial`, so creating from
it would mint a half-built object typed as a whole one. Use `set` where the object itself may be
missing.

**`__proto__`, `constructor` and `prototype` are refused as keys.** `get` takes a `string |
number`, so a key can come from data — a field name, a key off a parsed request body — and every
write ends in an assignment into the copy. Assigning to `__proto__` does not create a property:
it runs the setter `Object.prototype` provides and replaces the copy's prototype. They are
refused in a path, in `remove`, and in a `merge` partial (an object literal cannot carry an own
`__proto__`, but `JSON.parse` can).

This guard is **not** compiled out of the production build, unlike every diagnostic in the
package — only its message is. A check that ran solely in development would protect the one build
that was never exposed to a request. It costs 116 bytes gzipped, measured as `gzip -9` of the
minified bundle: 1216 → 1332 bytes.

**Documented, with no behaviour change:** that the result shares objects with the input, so
mutating either one mutates the other — the consequence of the identity guarantee, and the one
way to get a wrong result out of a correct write. Also an installation line, that the package
stands on its own with no dependency on the framework, that a branch of `and` has to `return`,
`insert`'s negative index, that the double-write guard and `focusOn(root).remove()` throw in
development and do nothing in production, and that `value()` cannot tell a missing path from a
present `undefined`. Every development message now has a page of its own — **Messages you might
see** — mapping each one to its cause and its fix.
