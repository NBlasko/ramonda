---
"@ramonda/query": minor
---

`InfiniteQuery` — pages under one key.

```tsx
private feed = this.use(InfiniteQuery, (self: Feed) =>
  infiniteQueryOptions({
    key: ["posts", self.props.tag],
    initialPageParam: 0,
    loadPage: ({ pageParam, signal }) => api.posts(pageParam as number, { signal }),
    getNextPageParam: (last) => last.nextCursor,
  }),
);
```

`pages` · `pageParams` · `fetchNextPage()` · `fetchPreviousPage()` · `hasNextPage` ·
`hasPreviousPage` · `isFetchingNextPage` · `isFetchingPreviousPage` · `maxPages`, plus
everything an ordinary query has — `status`, `error`, `result`, `refetch()`, and every
refetch trigger.

**It composes `Query` rather than extending or duplicating it.** Everything a paginated
query needs beyond pages is what `Query` already is: one entry per key, one shared request,
the mount/focus/reconnect/poll triggers, `invalidate`, the SSR snapshot, the subscription
that survives a key change. So it uses one — a hook using a hook — and the bag it hands over
is stable, because `key` is a value `Query` declares (`@StableProps`) and `fetch` is a bound
method. Extending would have meant making `Query`'s `fetch` prop optional to accommodate a
subclass that does not take one, weakening the type for every ordinary query.

**No change to the cache.** An entry's data is generic, so `{ pages, pageParams }` is just
another shape of answer — which is what makes `invalidate(["posts"])` mean "this list is
stale" rather than "page 3 is stale". Adding a page goes through the ordinary fetch path with
the merge happening inside the fetcher, so deduplication, abort, retry and the
superseded-result guard all keep working. Clicking "more" twice adds one page: a second
`fetchNextPage()` while one is in flight is dropped rather than queued.

**A refresh reloads every page it holds**, in order, with the params they were loaded with.
Reloading only the first would produce a list that never existed — page 1 from after the
change, pages 2..n from before it — and with cursors the seam can duplicate or skip rows. The
cost is one request per page, sequential because page N+1's param comes out of page N's data;
`maxPages` is the bound.

`infiniteQueryOptions` is the third options helper, and the one closest to necessary: `TPage`
comes from `loadPage`, nothing flows between two properties of the same object literal, so an
inline `getNextPageParam: (last) => …` has `last` as an implicit `any` (measured). Through the
helper the object is checked against a target type and every callback beside it is typed.

Nine tests, measuring the behaviour rather than the surface: one entry for the whole list, a
refresh that reloads both pages in order, the end-of-list signal coming from the app's own
getter, a dropped double-click, `maxPages` trimming from the far end, two components sharing
one request, `enabled: false`, and a failing page that keeps the pages that arrived.
