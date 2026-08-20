---
"@ramonda/core": minor
---

**`@StableProps` goes on a component now**, and means there what it means on a hook: *these props
are values, compare them by content.*

An object written in the JSX is a new object every render, so `<Panel filter={{ q: "open" }} />`
hands the child a changed prop every time and re-renders it forever. Measured: 5 parent renders, 5
child renders, for markup where nothing moved. Declaring the prop settles it:

    @StableProps("filter", "flags")
    export class Panel extends Component<{ filter: { q: string }; flags: string[] }> {}

Now the same markup re-renders the child **zero** times, and contents that really do move still
reach it — a declaration is not a freeze.

**It takes names, not a rule, and that is the point.** The other control a component had was
`@ShouldUpdateOnPropsChange`, which takes a PREDICATE — a thing an app can get wrong in the
direction that matters, a component that stops rendering when it should. The worst a wrong name here
can do is fail to type-check, and the names are checked against the component's own props exactly as
they are for a hook.

**The double render knows about it.** `RMD020` reports a value the second render built afresh, which
is precisely what an object literal in JSX is — so reporting it on a declared prop would be
reporting the fix the diagnostic's own advice recommends. It skips declared props now, and still
reports an undeclared one.

**Beside `@ShouldUpdateOnPropsChange`, the order is settled and tested.** `resolveStable` runs
first, so a hand-written gate is handed the SETTLED props — `previous.filter !== next.filter` sees
"the same" when the contents match, which is what the declaration promised. Resolving after the gate
would mean a component taking props identical to the ones it already had.

Under the hood it is the same `resolveStable` a hook's props already went through: the diff hands
back the identity the component already had while the contents match, so the bag comparison, the
signals and `@watchProp` all see what they would see if the parent had never rebuilt it. Nothing
downstream needed a special case, and a class that declares nothing skips the work entirely.

A function prop is still left alone — two closures with the same body are not equal by any
comparison that is safe to make — and contents are compared to a bounded depth, so a deeply nested
literal gets a fresh reference rather than a wrong one.
