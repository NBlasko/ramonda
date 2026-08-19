---
"@ramonda/core": patch
---

RMD020 and RMD022 descend into an **array** prop as well as an object one.

`cols={[{ key: "name", render: () => … }]}` — a table's column definitions — reported *"produced a
different value … so the value does not come from state"* against the whole array, which sends the reader
looking for a `Math.random()` that is not there. The two arrays differ only because a closure inside item
0 does. It reports `cols[0].render`, "the source is the same".

An array whose *length* disagrees between the two calls is not a rebuild, so that stays non-determinism —
the same rule the object side already applied to a differing set of keys.
