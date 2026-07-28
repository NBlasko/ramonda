---
title: Queries
description: Keys, staleness, and every moment a query decides to ask again.
section: Async data
order: 94
---

# Queries

## The key is the question

A key is an array, and two keys equal **by value** are the same query — the same
cache entry, the same request, the same answer.

```tsx
key: ["user", id]              // one user
key: ["posts", { page, tag }]  // a filtered page of posts
```

An array rather than a string so it can be built from the parts a component already
has, and so a **prefix** of it can be invalidated without string surgery:
`invalidate(["user"])` reaches `["user", 1]` and `["user", 2]` and leaves `["posts"]`
alone.

Object keys are compared by value, and their properties are sorted before hashing —
`{ page: 1, tag: "a" }` and `{ tag: "a", page: 1 }` are one query, so two components
writing the literal in a different order cannot split the cache in half.

**Keys must be JSON-serializable.** Not a rule invented here: the key is part of what
crosses the wire during hydration, which is the same constraint
[`@state`](/concepts/state) already lives under. A function or a symbol in a key is
worse than an error — `JSON.stringify` drops it, so two different queries hash
identically and each renders the other's data. Development builds report that as
`RMQ001`; a `Date` or a class instance is reported too, because neither hashes
stably.

## Changing the key asks a different question

The key usually depends on a prop, so a prop change is a key change:

```tsx
private user = this.use(Query, (self: UserCard) => ({
  key: ["user", self.props.id],
  fetch: ({ signal }: FetchContext) => api.getUser(self.props.id, { signal }),
}));
```

When `id` moves, the hook moves with it in the **same render**: it shows the new
key's state — pending, or whatever is cached for it — rather than the previous user's
name under the new user's heading for a frame. The request for the old key is
abandoned, and if you forwarded `ctx.signal` the browser stops it too.

Building the key array fresh on every render is fine and expected. The comparison is
by value, so a rebuilt `["user", 42]` changes nothing.

## Freshness

Two options, and they answer different questions.

**`staleTime`** — how long the data counts as fresh. While fresh, mounting another
observer of the same key does not refetch; it renders what is there. Defaults to `0`,
which means "stale the moment it arrives": right for data that changes under you, and
the reason navigating back to a page refreshes it.

**`gcTime`** — how long an entry with no observers is kept before it is dropped.
Defaults to five minutes. This is what makes going back instant: the data is still
there, shown immediately, and refreshed in the background if it is stale.

```tsx
{ staleTime: 30_000, gcTime: 10 * 60_000 }
```

A query with data can be refetching at the same time, and those are separate facts:
`isPending` is "there is nothing to show yet", `isFetching` is "a request is in
flight". Rendering a spinner for the second one blanks a screen that has something on
it.

## When it asks again

| Trigger | Default | Notes |
|---|---|---|
| `refetchOnMount` | `"stale"` | `"always"` ignores freshness; `false` never refreshes on mount. Data from the server counts as fresh — see [on the server](/query/server) |
| `refetchOnWindowFocus` | `true` | Only when STALE, so an alt-tab inside `staleTime` costs nothing |
| `refetchOnReconnect` | `true` | Same, when the browser comes back online |
| `refetchInterval` | off | Polls every N ms, and ignores staleness — an interval *is* the freshness policy |
| `refetch()` | — | Manual, ignores freshness, and joins a request already in flight rather than starting a second |
| `invalidate(key)` | — | Marks stale and asks whoever is watching to refresh; the data stays on screen while it does |

A query with **no** data fetches under all of these: `refetchOnMount` decides whether
to REFRESH, and there is nothing to refresh yet.

## Failure

`retry` defaults to 3 attempts after the first, with exponential backoff capped at
30 seconds (`1s, 2s, 4s…`) — a client that retries a struggling server immediately is
part of the problem. Both are options, and `retry` may be a predicate, which is what
an HTTP client wants:

```tsx
{ retry: (failureCount, error) => (error as HttpError).status >= 500 }
```

**A failed refetch keeps the data.** `status` becomes `"error"` while `data` still
holds the last known value, because a network failure does not mean what is on screen
became wrong — only that it could not be confirmed. Render both, or ignore one:

```tsx
if (this.user.isError && this.user.data) {
  return <p>{this.user.data.name} <small>could not refresh</small></p>;
}
```

## Holding a query back

A query that depends on something not there yet takes `enabled`:

```tsx
private orders = this.use(Query, (self: Panel) => ({
  key: ["orders", self.props.userId],
  fetch: ({ signal }: FetchContext) => api.getOrders(self.props.userId, { signal }),
  enabled: self.props.userId !== undefined,
}));
```

Nothing is fetched and the status stays `"pending"` until it flips. That is better
than the alternative people reach for — a key with a hole in it,
`["orders", undefined]` — which fetches with nothing, caches the failure under a key
that will never be asked for again, and renders an error the user cannot act on.

## Narrowing the result

The boolean getters are shortest, and they cannot narrow `data`: a getter tells the
compiler nothing about another getter, so `data` stays `T | undefined` however many
checks came before it. When you want it without a `!`, switch on `result`:

```tsx
render() {
  const user = this.user.result;
  if (user.status === "pending") return <p>Loading…</p>;
  if (user.status === "error") return <p>Failed.</p>;
  return <p>{user.data.name}</p>;   // data: User
}
```

## Reaching the cache directly

For imperative work — prefetching in a parent, invalidating after something happened
outside a mutation — reach the client with `QueryClientAccess`:

```tsx
class Page extends Component {
  private queries = this.use(QueryClientAccess);

  @mount
  warmUp() {
    // Loads what this page needs in ONE place, so the children below find their
    // data already cached instead of each fetching what the one above just learned.
    return this.queries.client.prefetch(["todos"], loadTodos);
  }
}
```

`prefetch` fetches only if what is cached is stale, and registers no observer. It is
the tool for flattening a waterfall — a server render
[gives up after ten sequential rounds](/ssr/async) of fetch-triggers-fetch, and one
prefetch above the tree is how a page stays under it.

Also on the client: `setData` (write straight into the cache — a fetch in flight is
abandoned, because an explicit write is newer information than a request made before
it), `peek`, `invalidate`, `remove` for a logout, and `cancel`.

## When the options should be one stable object

`key` is an array literal and `fetch` is usually a closure, so the options object is
rebuilt on every render of the owner. `Query` is built for that — it compares the key
part by part, measured at 31 ns — so there is nothing to do in the ordinary case.

If you want the whole thing stable anyway (a `@compute` of your own reads it, say), the
two forms are in [writing a hook](/hooks/writing#when-the-bag-should-stay-the-same-object):
a method instead of a closure for `fetch`, or a `@compute` holding the options, which
makes the key and the closure stable together.

## Next

- [Mutations](/query/mutations) — writing, and rolling back.
