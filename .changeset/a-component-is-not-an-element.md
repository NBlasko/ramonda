---
"@ramonda/core": minor
"@ramonda/check": minor
"@ramonda/router": minor
"@ramonda/testing-library": minor
"@ramonda/query": patch
---

A component owns a range of nodes rather than being one element, and `@Host` is gone with the
element it named.

A component's markup is what its `render()` returns, and nothing else. One element, several, or
none — a component that renders `null` has state, a lifecycle and hooks and no nodes at all. So two
`<td>` from one component sit inside the `<tr>` where an element would be foster-parented out in
front of the whole table, and a component that exists only to toggle other components costs the page
nothing.

The host element was never for the author. It was the diff's ANCHOR, and it charged for that
everywhere else: the tag was declared away from the markup, `display: contents` removed the box but
not the node so `.card > p` could not reach through a component, and a component could not produce
two siblings. The anchor does not have to be a node — `DiffAndMerge`'s ordering pass never searched
for one, it builds the target order for a block and walks it backwards — so a component is now a
third kind of `RecordEntry` beside `ListRegion`, and `isRegion` stays blind to which kind.

**Removed:** `@Host`, `@onElement`, `ref` on a component, and the `<ramonda-host>` element.
`RMD010`, `RMD042` and `RMD045` leave with the faults they described, and so does `@ramonda/check`'s
`listener-on-the-default-host`. Write the element in the render, put the listener and the ref on it,
and give a custom element a dashed tag — `JSX.IntrinsicElements` now accepts one, because `@Host` did.

**Server markup carries a comment pair per component**, with its state blob on the opening one:
`<tr><!--c7 {"state":{…}}--><td>…</td><td>…</td><!--/c7--></tr>`. Served markup is text and nothing in
plain HTML says where one component's run of nodes ends, so the server says it — in comments, because
a comment is the only thing the parser leaves alone inside a `<tr>`. Hydration consumes and removes
them, so a hydrated page holds exactly what a client render would have produced, and a client render
never writes one. The blob moved with them: it used to be `data-ramonda-state` on the host element.

**Measured, not asserted.** `RenderCost` counts DOM operations, and a list of 200 component rows costs
what 200 element rows cost — two insertions to append or prepend, two to swap, `N - 1` to reverse,
nothing for a fresh array of the same rows. An empty component filling in costs what a plain
conditional hole costs, so the sibling search it has to do costs no DOM operation. The child record is
kept per region owner rather than per component, so it does not grow with a list.

`@ramonda/router`'s `Link` writes its `<a>` in the render, where the href and the click handler that
has to agree with it sit together. `@ramonda/testing-library`'s `renderHook` finds its host through
the record, and `@ramonda/core/testing` gains `getComponentsIn` for that — which is also the only way
to find a component that renders nothing, since no node points at one.
