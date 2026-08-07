---
"@ramonda/form": patch
---

The two bookkeeping walks, measured and made cheaper

Neither is on a keystroke, which is why they were not what `Field` addressed — but both are paid on
ordinary interactions, and both were spending most of their time rebuilding strings.

**`forgetUnder`, which every array operation runs through: 424 µs → 42 µs** over a form of 1208
recorded paths. The coverage test took a `Path` and so rebuilt `pathKey(path)` and `keyPrefix(path)`
for *every key it was asked about*; it is now built once per call. The issues map is copied only if
something is actually dropped, and the touch sets no longer copy every key to delete a few.

**`touchAll`, once per submit: 884 µs → 261 µs** over 1208 paths. It built a fresh `[...path, key]`
array per node and ran `pathKey` over it; the key is now carried down from the parent, and
`Object.keys` replaces `Object.entries`, which was allocating a pair array per node. What is left is a
concatenation and a `Set.add` per path.

`childKey` sits beside `pathKey` in `path.ts` so the two spellings of one key format cannot drift, and
a test asserts they agree — including for an index, a property name containing the characters the
readable form uses, and the empty-string property name that shares the root's key.

Also covered for the first time: `forgetUnder` over the ROOT, which is a form whose whole value is an
array. Its own mark must survive an operation on itself while every mark beneath it goes, and nothing
had ever asked.
