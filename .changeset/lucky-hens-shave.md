---
"@ramonda/core": patch
---

`index` in a list's `render` no longer goes stale after a reorder

The per-item clean-skip reused an item's vnode when the object was unchanged and none of the signals
it read had fired. An item's INDEX is neither: it is the position in `each`, and a reorder changes it
while changing nothing the skip looked at. So a row that moved kept the vnode built at its old
position, and `render: (item, index) => …` displayed a number that no longer matched where the row
was — silently, and only after a reorder.

An item that moved is now rebuilt, but only when the mapper can actually see its position, which is
read from the parameter list: `(item, index) => …` gets the check, `(item) => …` keeps the skip
untouched. A 10000-row list that never mentions the index still reorders without a single mapper
call, and only the rows whose position really changed pay for one. `as` components take no index and
are unaffected.

The one gap is a mapper that hides its arity — `(item, index = 0)` or `(...args)` — which reports
fewer parameters than it uses and so opts out of the check. Documented on `render`.
