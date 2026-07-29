---
"@ramonda/query": minor
---

A query only re-renders its owner for the parts the owner actually reads.

A cache entry changes three times per refetch — the fetch starts, the data arrives, the
freshness moves — and each one used to wake the owner. Measured on a query whose rendered
value never changed: **three refetches, nine renders.** Two of every three were for facts
the component never asked about.

The getters record which facet was read (data, status, error, fetchStatus, failureCount,
updatedAt, restored), and a notification compares only those. Same shape TanStack and SWR
arrived at by proxying their result object; here the getters are already the access points,
so a bit per facet is enough. Measured after: a component reading one field is woken **once
per refetch** instead of three times, and a component that reads `isFetching` still gets
every transition, because reading it subscribes to it.

**The read set never shrinks**, deliberately: a component that reads `isFetching` inside a
branch would otherwise stop being woken the moment the branch is not taken, and would show a
stale spinner the next time it is. Accumulating errs towards more renders, which is the safe
direction.

`data` and `error` are compared by identity, because that is what the cache guarantees — it
REPLACES `data` when a fetch lands, so a refetch returning an equal-but-new object still
counts as a change. Closing that last gap is what `select` or structural sharing would be
for, and this deliberately is not that: it is the part that needs no new API.

**RMQ002's question changed with it, and improved.** It asked "did this render look at the
failure"; it now asks "does this reader ever look", using the same read set. It had to
change: a query read only through `data` fails, changes nothing visible, and is no longer
woken — so a render-based check could not see it either. The new question is the better one
anyway, since a component that has read `isError` once demonstrably has the branch.

Five tests hold the counts, including two that would catch an over-eager gate: the first
paint is never skipped (nothing has been read yet, so everything counts), and the
component's own state changes still render.
