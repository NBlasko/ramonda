---
title: Queries on the server
description: The data lands in the HTML, the client renders it on the first pass, and nothing refetches — with nothing to wire up.
section: Async data
order: 97
---

# Queries on the server

A server render waits for what a query fetches, so the data is in the page. Then it
travels to the client, which renders it on its **first** pass and does not fetch it
again. There is nothing to configure for any of that.

```tsx
class UserCard extends Component<{ id: string }> {
  private user = this.use(Query, (self: UserCard) => ({
    key: ["user", self.props.id],
    fetch: self.load,
  }));

  load({ signal }: FetchContext) {
    return api.getUser(this.props.id, { signal });
  }

  render() {
    return <p>{this.user.data?.name ?? "…"}</p>;
  }
}
```

`renderToString` on that produces the name, not a spinner.

## How it works, and why there is no API for it

Two mechanisms the framework already has, and neither is new here.

**Waiting** is [async on the server](/ssr/async): a lifecycle method that returns a
promise is awaited during a server render. The query's `@mount` returns the fetch, so
the render waits for it and for whatever that starts, then serializes.

**Travelling** is the [hydration blob](/ssr/index). Every hook's `@state` is
serialized per component and restored before any client render — so the query keeps
its answer in a `@state` field and it rides along with everything else the component
was holding. That is why there is no `dehydrate()` to call, no boundary component to
place, and no script tag to add: the transport already existed.

The cost is honest: two observers of one key each carry a copy. Bytes, not
correctness — and if that matters for a page,
[the explicit route](#sending-the-cache-once) is exported.

## Why the first render matters

The client's first render has to produce what the server produced. If it rendered a
spinner instead, hydration would find markup that disagrees with it and resolve that
by **throwing the server's markup away** — the reader watches finished content flash
into a placeholder, and the framework reports it as
[RMD007](/ssr/mismatches).

So the restored data is put into the cache on the read path, before anything renders,
rather than from a lifecycle that runs after the first commit. Nothing to do; it is
worth knowing because it is the reason the pattern works at all.

## Server data counts as fresh

`staleTime` defaults to `0`, which means "stale the moment it arrives". Taken
literally on hydration that would refetch every query on the page the instant it
became interactive — doubling every request, on the most common setup there is.

So data that came from the server is treated as being **as fresh as the document that
carried it**: mounting does not refresh it. Ask for both explicitly if you want them:

```tsx
{ refetchOnMount: "always" }   // render the server's data, then refresh it
```

`isRestored` tells you where the data came from, for a UI that wants to say so.

Timestamps are not compared across the boundary, and that is on purpose: the server
stamps its clock, the client reads its own, and two machines' clocks differ by seconds
routinely — so a restored entry would look either fresher or staler than it is, at
random. The restore stamps the client's clock instead.

## Failures cross too

A fetch that failed on the server renders its failure on the client, rather than a
spinner that never resolves. It has to be translated to get there: `JSON.stringify(new
Error("nope"))` is `{}` — `name`, `message` and `stack` are all non-enumerable — so
the failure travels as `{ name, message }` and arrives as a `ServerQueryError`, a real
`Error` subclass, so `error.message` and `error instanceof Error` keep working.

`stack` is deliberately not carried: it points into the server's bundle, which no
client-side source map can resolve, and a stack that leads nowhere is worse than an
honest absence.

## Flattening the waterfall

A server render gives up after **ten** sequential rounds of async work, because that
many round trips in a row is a waterfall worth surfacing rather than absorbing into a
response time nobody can explain.

The fix is to load what a page needs in one place:

```tsx
class TodosPage extends Component {
  private queries = this.use(QueryClientAccess);

  @mount
  load() {
    // Returned, so the server waits for it. The children below find their data
    // already cached instead of each fetching what the one above just learned.
    return this.queries.client.prefetch(["todos"], loadTodos);
  }
}
```

## Sending the cache once

For a server that would rather fetch outside the tree and hand the cache over —
prefetching in a route handler, sending one payload instead of one per observer —
`dehydrate` and `hydrate` are exported:

```ts
// server
const client = new QueryClient();
await client.prefetch(["todos"], loadTodos);
const html = await renderToString(<App client={client} />);
const payload = JSON.stringify(client.dehydrate());
```

```ts
// client
const client = new QueryClient();
client.hydrate(JSON.parse(payload));
// …and pass it in: this.use(QueryClientProvider, () => ({ client }))
```

`hydrate` will not overwrite data the client already fetched itself — a page that
loaded something before the payload arrived knows better than the payload does.

## What does not run on the server

Effects never do, so focus and reconnect refetching and polling are client-only by
construction. `enabled` is read once, when the query mounts, which is the only moment
a server render has.

## Next

- [Testing queries](/query/testing) — including a server render, end to end.
