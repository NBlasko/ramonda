---
"@ramonda/core": patch
---

A list inside a list's row updates when only its own rows read the change

Categories, each listing products priced in `this.currency`: the category callback never reads the
currency, the product callback does. Once a pass had reused the category rows — a sort, a refetch of
the same objects, an append, or a plain `[...categories]` — every category row was marked clean, the
diff claimed each one without opening it, and a change of currency left every price as it was. Keyed
and unkeyed rows alike, because a row without a key is given one.

A row now knows when something INSIDE it changed. A list the diff builds inside a row is told which
row it is in, and when one of its own rows is invalidated it marks every row above it, up to the
first already marked. A marked row is not clean: the diff opens it to reach the list that changed, and
its callback does not run again. Hydration tells its lists the same thing. A component resets it — a
component's lists report to the component, which re-renders itself.

`AListInsideARow.test.tsx` covers a list directly in a row, beside other children, two levels down,
and after hydration; each piece of the change, taken out on its own, fails it.
