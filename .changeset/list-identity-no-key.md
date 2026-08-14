---
"@ramonda/form": patch
---

The arrays page stops teaching a key that is no longer needed.

It said `key={row.id}` "is the whole point" of rendering form rows. That was true when it was
written and is not now: a row carries a generated `id` that survives a remove, and `list()` aligns
the incoming rows against the ones on screen by what they still have in common — the `id` is that
thing, and `index`, which restates the position, is deliberately ignored. The fix that ignores it
was made for exactly this shape.

Measured on the real form: after `remove(0)`, both surviving rows kept their DOM nodes with no key
written. A test in `Arrays.test.tsx` now pins it, because the alternative is silent — a rebuilt row
looks identical and only loses what the browser was holding: the caret, the selection, an open
datalist.

Nothing changed in the framework. This is the documentation catching up with it, and one fewer
thing to write.
