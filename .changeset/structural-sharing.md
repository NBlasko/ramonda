---
"@ramonda/query": minor
---

Structural sharing, on by default: an answer equal to the one already held IS the one already
held.

A fetch replaces `entry.data` with whatever the fetcher returned — a fresh object every time,
even when the bytes are identical — so every poll looked like a change and re-rendered every
observer. Measured in jsdom, the comparison against the render it prevents, on rows of six
fields:

```
  rows   deep compare   JSON.stringify   render + DOM commit
  10        28 µs           28 µs             5.4 ms
  100      137 µs          136 µs            26 ms
  1000     811 µs        1 287 µs           272 ms
```

The commit is 190–335× the comparison, so the trade is not close. jsdom is not a browser —
no layout, no paint, slower nodes — but nothing plausible closes two orders of magnitude. With
sharing on, the same benchmark does **31 equal writes for zero renders**, where before it did
31.

**It rebuilds rather than answering yes or no**, which costs the same walk and buys the harder
case too: every unchanged SUBSTRUCTURE keeps its identity, and `list()` reuses an item's scope
when `existing.item === item` — so a response where one row moved re-renders one row instead
of all of them. There is a test for exactly that: five rows, one changed, one row render.

**Two bounds, and it takes both.** A node budget for width and a depth cap for recursion. The
budget alone was the first version, and a test killed it: a cyclic response recurses one frame
per visit, so it blew the call stack long before 20 000 visits. Past either bound the new value
is returned as-is — the safe direction, since an unnecessary render costs a frame while a
missed one shows stale data forever.

Only arrays and plain objects are traversed. A `Date`, a `Map`, a class instance — anything
with a prototype of its own — is compared by identity, because equality for those is the app's
business and guessing it wrong is worse than a render.

`structuralSharing: false` turns it off, per query or as a provider default, for a payload
that is always different and large enough for the walk to be pure cost.

This is the layer that finishes what access tracking started: tracking removed the renders for
facts the component never read, and this removes the ones where the data itself did not
actually change. What is left — "the data changed but the slice I use did not" — is what
`select` would be for, and it is now the only thing left for it to do.
