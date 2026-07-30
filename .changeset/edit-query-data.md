---
"@ramonda/query": minor
"@ramonda/devtools": minor
---

Edit a query's cached data from the panel — the one edit you see on the page immediately.

Asked for after editing a query hook's `version` and seeing nothing: that field is an invalidation
counter, so the write landed and the page still rendered from the cache. The **cache** is the thing to
edit, and now `✎` on a Query row does it.

It goes through the same `setData` an optimistic update calls, so nothing about the write is special: a
fetch in flight is abandoned (it is older information than the write), structural sharing keeps the
identity of what did not change, `updatedAt` moves, status becomes `success`, and every observer is
notified. A refetch replaces it, which the panel says as it writes.

Two refusals, both deliberate:

- **No pencil for a value that arrived truncated.** The bridge sends a bounded copy, and a bounded copy
  carries markers where values were dropped — writing one back would put `"[… budget]"` into the cache.
  The bridge reports whether the copy is the whole value, and the panel only offers an edit when it is.
- **No pencil when the query package is older than the panel**, since it has no write side to call.

The list also holds still while you are typing into it: a cache event anywhere rebuilds it twice a
second, and without that the box would vanish mid-sentence.
