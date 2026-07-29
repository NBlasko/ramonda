---
"@ramonda/query": minor
---

`RMQ002` — a query failed and the render never looked. And deliberately no `throwOnError`.

The option other libraries have rethrows a failure so an error boundary catches it. It is not
built here, and the reason is what a boundary DOES: it replaces the subtree, which means
unmounting — `@destroy`, cleanups, local state, focus, scroll position — and a retry then has
to rebuild all of it. A failed fetch is not an unexpected situation; the network fails
routinely, which is why `Query` models a failure as state and keeps the data it had. Handing
that to a boundary punishes the reader for somebody else's timeout.

What people actually get from `throwOnError` is *noticing*, and noticing is a diagnostic. So
in a development build, a query in `error` whose render read none of `isError`, `error`,
`status` or `result` is reported, with the key and the failure named. It matters because a
failed refetch keeps its data: the page looks healthy while showing values nobody can refresh.

Judged per render — the flag is cleared after each check, so a component that showed the error
and then stopped (a collapsed panel, a switched tab) is reported again rather than excused by
an earlier render.

Two details worth recording. The check reads the ATTACHED entry rather than
`peek(this.props.key)`, because peeking hashes the key and this runs after every render — the
first version undid the identity fast path (723 ns → 31 ns) and the test that holds it failed
immediately. And it runs from `@updated` *and* `@mount`: an error restored from a server render
is already on screen at the first paint, with no second render for `@updated` to follow.

Also: `/query/queries` gains the pattern for a failure that means the page cannot be shown —
`if (this.user.isError) return <NotFound />` — which unmounts exactly what the app chose to,
and nothing else.
