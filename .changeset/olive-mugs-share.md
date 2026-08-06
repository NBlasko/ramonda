---
"@ramonda/core": patch
---

An `ErrorBoundary` covers more than the docs said, and a context subscription is described as it works

**The boundary.** The page said an `@updated`, or a subscription's `connect`, that throws is
"reported, not caught here". Both are caught: `flushUpdated` and `flushPostCommit` route through the
same `errorHandler` a render does. The line is not "render versus the rest" — it is **whether the
framework was the one calling**. A render, a `@create`, a `@compute`, an `@mount`, an `@updated` all
run on the framework's own path, so the error can be walked up to a boundary. A click cannot: the
browser calls the listener directly, so the throw never passes through the framework at all. A page
that believed its boundary stopped at the render would write a `try/catch` it does not need — or
trust a narrower boundary than it has.

**Context.** Three things follow from per-key tracking and none of them is guessable, so they are
written down now: the tie is made on the first read and lasts until the component goes (a branch you
stop taking does not unsubscribe); a key is compared, not explored, so changing something inside a
key's value tells nobody; and a consumer looks for its provider once, when it is created.

Both are pinned by tests, because prose is the one thing types, lint and tests all pass over.
