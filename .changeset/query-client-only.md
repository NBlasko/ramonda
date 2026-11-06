---
"@ramonda/query": minor
---

`clientOnly: true` on a `Query` or an `InfiniteQuery`, for data only the browser has — IndexedDB, `localStorage`, a file the reader picked. A server render (and a page baked at build time) does not fetch it — not on mount, and not when its key moves, it is invalidated, `refetch()` is called or an infinite query asks for another page during the render — and renders the query pending; the client's first render shows the same, so hydration keeps the page, and then it fetches. A boolean, so it compiles in a props object with nothing pinned.
