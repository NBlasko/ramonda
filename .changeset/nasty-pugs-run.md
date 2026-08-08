---
"@ramonda/core": patch
---

Three from the review backlog: a dropped element ref, a mutated attributes object, and a README that described removed behaviour

**An element went on holding a `ref` the JSX had stopped giving it.** `ref` is not a DOM attribute, so
it is never among the previous attributes read back off the node, and the attach loop only walks the
keys present in the next ones — a disappearing `ref` was invisible to both. The element kept a strong
reference to the handle, and `current` stayed aimed at an element the JSX no longer connected it to.
A component's ref has behaved correctly since it was unified across create, update and adopt; this is
the same rule on the element side. The deliberate re-assertion is untouched, so two elements sharing
one ref still fall back to the first when the second goes away.

**`class` → `className` was rewriting the caller's object.** JSX builds a fresh props object per
element so the compiler never showed it, but `__h` is public and callable, and the `children` copy
three lines away exists for exactly this reason — measured, when one attributes bag used for two
elements ended up with only the last one's children. Deleting `class` also swallowed the rename
warning for every later use of that object, though the source still said `class`. It copies now, and
only on the path that is already the wrong spelling.

**The README sold an opt-out that no longer exists.** An underscore-prefixed method "deliberately left
unbound", with a performance table and a paragraph on the trade — for behaviour removed on
2026-07-29, because a `naming-convention` lint rule set to `leadingUnderscore: "require"` silently
produced `this`-loss. A reader would have avoided the prefix to keep `this`, or reached for it to save
the binding, and both conclusions were wrong. The section now says why there is no opt-out, carries
the measurements that are current, and names the `@unbound` decorator a future one would be.
`ReadmeBinding.test.ts` pins it: prose is the one thing types, lint and tests all pass over.
