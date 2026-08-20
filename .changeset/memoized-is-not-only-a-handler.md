---
"@ramonda/core": minor
"@ramonda/check": patch
---

**`@memoizedHandler` is `@memoized`.** It caches a value as readily as a handler, and the old name hid
that from the people who needed it.

Measured: `@memoized cfg(id) { return { id } }` returns the same object for the same argument, one build.
Nothing ever restricted it to functions, and nothing warned — so a row that needs a stable object had the
same problem and the same answer, under a name that said `Handler`.

**The cost of the old name was not confusion, it was non-discovery — and the diagnostics proved it.** The
`object` verdict of `RMD020` and `RMD022` advised "a `@compute` getter, a field, or a module constant".
None of those can hold one value PER ITEM: a `@compute` belongs to the component, not to the row. So a
developer whose object was rebuilt per row was given advice that cannot work, and the only tool that works
was called something else. Both advices now name `@memoized` for that case.

`/concepts/events` says it too — the section is "A handler, or a value, per item", with the object example
and the reason nothing else reaches it.

**Migration is a rename and nothing else:** `@memoizedHandler` → `@memoized`. The behaviour, the cache
key, the eviction and the tracking are unchanged. `@ramonda/check`'s reports and advice use the new name,
and `unkeyable-memoized-argument` keeps its id — it already read "memoized".
