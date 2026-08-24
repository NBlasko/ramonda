---
title: Infinite queries
description: Pages under one key, loaded as far as the reader goes.
section: Async data
order: 96
---

# Infinite queries

A feed, a search result, an activity log — one question whose answer arrives a page at a
time. `InfiniteQuery` holds the whole list as **one cache entry**, so it behaves like any
other query: one request per key however many components watch it, one `invalidate` to mark
the list stale, one snapshot across the SSR boundary.

```tsx
import { InfiniteQuery } from "@ramonda/query";

// One page of the feed. A `render:` callback has to produce an element, so a nested
// list goes through a component — one item to the outer list, and the rows are what it renders.
class PostPageView extends Component<{ item: PostPage }> {
  render() {
    return list(this.props.item.items, (item) => <PostRow item={item} />);
  }
}

class Feed extends Component<{ tag: string }> {
  private feed = this.use(InfiniteQuery<PostPage>, (self: Feed) => ({
    key: ["posts", self.props.tag],
    initialPageParam: 0,
    loadPage: ({ pageParam, signal }) => api.posts(pageParam as number, { signal }),
    getNextPageParam: (last) => last.nextCursor,
  }));

  render() {
    if (this.feed.isPending) return <p>Loading…</p>;
    return (
      <div>
        {list(this.feed.pages, (item) => <PostPageView item={item} />)}
        <button
          type="button"
          onclick={this.feed.fetchNextPage}
          disabled={!this.feed.hasNextPage || this.feed.isFetchingNextPage}
        >
          {this.feed.isFetchingNextPage ? "loading…" : "more"}
        </button>
      </div>
    );
  }
}
```

## The three things you supply

**`initialPageParam`** — what identifies the first page. An offset of `0`, a null cursor,
`1`. It is passed to `loadPage` as `pageParam`, and it is yours: the framework never
interprets it.

**`loadPage({ key, signal, pageParam })`** — loads one page. Forward `signal` so a list the
reader navigated away from stops fetching.

**`getNextPageParam(lastPage, pages, lastPageParam, pageParams)`** — what to ask for next,
or `undefined` when there is no more. Returning `undefined` **is** the end-of-list signal,
and it is what `hasNextPage` reads. Add `getPreviousPageParam` for a list that grows both
ways (a chat scrolled upwards); without it `hasPreviousPage` is always false.

Naming the page type — `InfiniteQuery<PostPage>` — is worth it here more than anywhere.
Left off, `TPage` would come from `loadPage`, and nothing flows between two properties of
the same object literal, so `getNextPageParam: (last) => …` would have `last` as an
implicit `any`. Naming it once reverses the direction and types every callback beside it.
See [typing the callbacks](/query#typing-the-callbacks).

## What it gives you

| | |
|---|---|
| `pages` | the pages, oldest first — the same array identity while nothing changed |
| `pageParams` | the param each page was loaded with, in the same order |
| `fetchNextPage()` | adds one page at the end |
| `fetchPreviousPage()` | adds one at the start |
| `hasNextPage` / `hasPreviousPage` | whether your getter has something to ask for |
| `isFetchingNextPage` / `isFetchingPreviousPage` | narrower than `isFetching`, and what a "more" button should ask |
| `maxPages` | keep at most N, dropping from the far end |

Everything an ordinary [query](/query/queries) has is here too — `status`, `isPending`,
`isError`, `error`, `isFetching`, `result`, `refetch()`, and every
[refetch trigger](/query/queries#when-it-asks-again).

**Clicking "more" twice adds one page, not two.** A second `fetchNextPage()` while one is in
flight is dropped rather than queued.

## A refresh reloads every page it has

`refetch()` — and an `invalidate` reaching this key — reloads all the pages currently held,
in order, with the params they were loaded with. Not just the first, and not a reset to one
page.

The reason is that the alternative produces a list that never existed: page 1 from after the
change, pages 2..n from before it. Cursors make that worse than untidy — page 2's cursor came
out of the *old* page 1, so the seam can duplicate or skip rows.

The cost is one request per page held, sequentially, because page N+1's param comes out of
page N's data — there is nothing to parallelise. `maxPages` is the bound if a list can grow
far enough for that to matter.

## On the server

Nothing to configure, exactly as with an ordinary query: a server render waits for the first
page, the data travels in the document, and the client renders it without fetching again. See
[on the server](/query/server) — the entry it restores is the whole `{ pages, pageParams }`
object, so `fetchNextPage()` on the client continues from where the server stopped.

## Next

- [On the server](/query/server) — how the data crosses.
- [Testing](/query/testing) — waiting for a page in a test.
