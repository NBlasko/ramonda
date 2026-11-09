---
"@ramonda/core": patch
---

A component with two `@memoized` methods keeps its handlers across renders

Every `@memoized` method on a component shares one cache, swept once per commit to drop the entries no
render asked for. It was swept once per method: with two, the first sweep marked every entry unused and
the second deleted them all, so each commit built every handler again — and whatever held one saw a new
function. A table whose rows were handed `select(id)` and `remove(id)` re-rendered every row on every
select. The cache is now swept once per component, and a handler keeps its identity for as long as a
render asks for it.
