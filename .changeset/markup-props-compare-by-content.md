---
"@ramonda/core": minor
"@ramonda/check": minor
---

Markup handed down as a prop is compared by what it says, so a parent's render no longer re-renders a child whose markup is unchanged

JSX is built afresh by every render, so `<Panel><Big n={1} /></Panel>` handed `Panel` new `children`
each time and `Panel` rendered whenever its parent did — `@StableProps("children")` was the only way
out, and it stopped two elements deep. Markup — `children`, a node as a prop, a slots object, an
array of nodes, a `list()` among the children — is now compared by content for every component and
every hook, with no declaration. Measured in a production build, 20 panels of 500 elements under a
parent whose state changed for an unrelated reason: 25.1 ms and 20 panel renders per change before,
0.2 ms and none after; when the markup really changes, 25.4 ms before and 25.5 ms after.

Only markup is opened. Data — a row, a `filter` object, an array of records — is compared by
reference wherever it appears, including as an attribute inside markup: a row changed in place
compares equal to the copy made from it, and opening it would hide the change. `@StableProps` remains
the way to compare data by content. Markup built by a different component, a `list()` whose callback
changed, and markup past a budget of 500 values are all called different — the child renders, as it
did before.

`Portal` now watches its `target` together with its `children`, and reconciles once when both
change. It used to notice a new target through `children`, which a props factory rebuilt on every
run; with markup settled, a target change with the same children would otherwise not move the block.

`@ramonda/check`: `fresh-object-in-props` no longer reports a literal holding only markup and
primitives — `slots={{ header: <Header /> }}` — since the runtime settles it. One holding data beside
the markup is still reported.
