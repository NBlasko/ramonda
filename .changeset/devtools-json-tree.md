---
"@ramonda/devtools": minor
"@ramonda/query": minor
---

Every value in the panel is a collapsible tree, and any of them opens on the whole panel.

The one-line preview was raised twice — 120 → 2000 for a query, 200 → 8000 for state and props —
and the ellipsis came back both times. The sizes that matter are not near any cap: an infinite
query holding eight pages of products is a hundred kilobytes, and no line length makes that
readable. Length was never the problem; structure was.

So a value renders the way a browser renders one: keys and types coloured, containers labelled by
size (`pages: Array(8)`), everything past the first level collapsed until you open it. `⤢` on any
row opens that value on the whole panel, where it can be scrolled, switched to pretty-printed JSON,
and copied. This applies everywhere — state, a hook's props, a component's props, a query's data.

Two limits, and it takes both: a node budget bounds the width, a depth cap bounds the recursion,
and a cycle is named as `[circular]` rather than truncated. Whatever is dropped says so in the row
where it was dropped.

`@ramonda/query`'s bridge now sends the cached value as a bounded **copy** rather than a preview
string, so the panel cannot hold the app's objects alive or mutate them. Two related fixes fell
out: the Query list's change signal moved from the preview to `updatedAt` — a preview is capped, so
appending an eighth page changed nothing within the cap and the panel went on showing the seventh —
and the panel's value-patching path looks its element up in a Map instead of a
`[data-sv="…"]` selector, because a prop name can carry a quote, which is exactly the bug that made
the query hash throw on every poll.
