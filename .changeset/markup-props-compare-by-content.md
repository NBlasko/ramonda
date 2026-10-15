---
"@ramonda/core": minor
"@ramonda/check": patch
---

Markup handed down as a prop is compared by what it says, so a parent's render no longer re-renders a child whose markup is unchanged

JSX is built afresh by every render, so `<Panel><Big n={1} /></Panel>` handed `Panel` new `children`
each time and `Panel` rendered whenever its parent did. Children, a single node as a prop
(`header={<Header />}`), and a `list()` with a method or module-level callback — among the children
or as a prop of its own — are now compared by content for every component and every hook, with no declaration. Measured in a
production build, 20 panels of 500 elements under a parent whose state changed for an unrelated
reason: 25.1 ms and 20 panel renders per change before, 0.2 ms and none after; when the markup
really changes, 25.4 ms before and 25.5 ms after.

Only what the framework built is opened — a vnode, the children array JSX makes, a list. Everything
the app builds is compared by reference, including an object or an array that holds nodes
(`slots={{ header: <Header /> }}`): the app may change it in place, and a copy of something changed in
place compares equal to the original, so the change would never be shown. Such a slots prop is
declared on the child with `@StableProps("slots")`. Markup built by a different component, a `list()`
whose callback changed, and markup past a budget of 500 values are all called different — the child
renders, as it did before.

`Portal` now watches its `target` together with its `children`, and reconciles once when both
change; a named target (`portalTarget("modal")`) is watched by the container that carries the name,
so a new token for the same container is no change and a container replaced under the name is
followed. It used to notice a new target through `children`, which a props factory rebuilt on every
run; with markup settled, a target change with the same children would otherwise not move the block.

A `@watchProp` on `children`, or a `@compute` reading it, now runs only when the children say
something different. A hook that noticed some other prop through `children` being new on every run —
as `Portal` did with its target — should watch that prop itself.

`RMD022` no longer reports a hook's markup that the runtime settles; markup holding a handler built
in place is still reported.

`@ramonda/check`: `fresh-object-in-props` names `@StableProps("slots")` as the answer for a slots
object or an array of nodes.
