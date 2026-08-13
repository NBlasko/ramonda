---
"@ramonda/check": minor
---

JSX written outside a component class is an edge too.

`function row() { return <Cell /> }` mounts `Cell` wherever it is called, and nothing owned that tag
before: JSX outside a class was read only inside a route table or a `bootstrap` argument, and
everything else was invisible rather than a hole — so a consumer reached only through a helper was
never judged at all.

Nothing has to be followed to fix that. The tag is written in the helper, so the edge is read where
it is; only the owner was in question. The answer is the helper itself, as a node of its own
(`"kind": "helper"`), with a `calls` edge from every component that reaches it — and the report then
names it: `App → Bare → row → Cell`. Three spellings are read: a declared function, a const holding
an arrow or a function expression, and a method of a class that is not a component.

A route table and a `bootstrap` argument are not helpers. Both are read where they are written, and
counting them twice would give one mount two owners.

Four turned up in this repository's own apps, all of them SSR entries — `entry-server.tsx`'s
`render` and `prerender`, and the docs site's `renderOne`. They render `<App />` into a string
rather than mounting it, so they were not roots and nothing else saw them either. They are in the
graph now, as facts, with nothing calling them.
