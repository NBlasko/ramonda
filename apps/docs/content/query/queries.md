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
  key: ["user", self.props.id],   // a literal; Query holds its identity
  fetch: self.load,               // a bound method, not a closure
}));
```

When `id` moves, the hook moves with it in the **same render**: it shows the new
key's state — pending, or whatever is cached for it — rather than the previous user's
name under the new user's heading for a frame. The request for the old key is
abandoned, and if you forwarded `ctx.signal` the browser stops it too.

Write the key array as a literal — that is the whole point of it. `Query` declares `key`
as a value (`static StableProps`), so the framework hands back **one array identity** for
as long as the parts are equal: nothing that reads the key sees a change, and the
comparison costs 31 ns. You do not wrap it in anything.

`fetch` is the one to watch, because a function cannot be compared that way. Pass a
**bound method** — `fetch: self.load`, reading `this.props` when it is called — rather than
an inline closure, which is a new prop on every render. Development builds report the
closure form as [RMD022](/reference/diagnostics/rmd022).

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

## An equal answer is the same answer

When a fetch returns data equal to what is already cached, the cache **keeps the object it
had** — so nothing re-renders. And when the answer did change, every part that did not keeps
its identity, which is what lets [`list()`](/lists) re-render the rows that moved instead of
all of them.

Measured in jsdom against the render it prevents, on rows of six fields: 28 µs of comparison
versus 5.4 ms of commit at ten rows, 811 µs versus 272 ms at a thousand. A polled query that
returns the same page is the common case, not the exception, so this is on by default.

```tsx
{ structuralSharing: false }   // for a payload that is always different and big
```

Turn it off only for that: a response large enough for the walk to matter *and* different on
every fetch, where the comparison is pure cost. Arrays and plain objects are compared; a
`Date`, a `Map` or a class instance is compared by identity, because equality for those is
yours to define.

## When it asks again

| Trigger | Default | Notes |
|---|---|---|
| `refetchOnMount` | `"stale"` | `"always"` ignores freshness; `false` never refreshes on mount. Data from the server counts as fresh — see [on the server](/query/server) |
| `refetchOnWindowFocus` | `true` | When the tab becomes **visible** again, and only when STALE — an alt-tab inside `staleTime` costs nothing |
| `refetchOnReconnect` | `true` | Same, when the browser comes back online |
| `refetchInterval` | off | Polls every N ms, and ignores staleness — an interval *is* the freshness policy |
| `refetch()` | — | Manual, ignores freshness, and joins a request already in flight rather than starting a second |
| `invalidate(key)` | — | Marks stale and asks whoever is watching to refresh; the data stays on screen while it does |

The visibility trigger is named `focus` and watches `document.visibilityState`, which is the
question it is really asking. So a window that gains focus having been visible all along — a second
monitor, a split screen, DevTools — does not refetch, and a phone returning from the background does.
A focus event reports neither of those reliably.

A query with **no** data fetches under all of these: `refetchOnMount` decides whether
to REFRESH, and there is nothing to refresh yet.

## Failure

`retry` defaults to 3 attempts after the first, with exponential backoff capped at
30 seconds (`1s, 2s, 4s…`) — a client that retries a struggling server immediately is
part of the problem. Both are options, and `retry` may be a predicate, which is what
an HTTP client wants:

```tsx
{ retry: (failureCount, error) => error instanceof HttpError && error.status >= 500 }
```

**`error` is always an `Error`.** A fetcher is your code and may reject with anything — a string
after a validation, a status number, an object parsed out of a JSON error body — so a rejection that
is not an `Error` is wrapped in one, and the value it was is kept on `cause`:

```tsx
fetch: () => Promise.reject("not found")
// error.message === "not found"
// error.cause   === "not found"
```

That is why the predicate above asks `instanceof` rather than casting: a cast says `HttpError` about
whatever arrived, and `error.status` is then `undefined` in a comparison that quietly answers `false`.
An `Error` your own code threw is passed through as itself, so `instanceof YourError` holds.

**A failed refetch keeps the data.** `status` becomes `"error"` while `data` still
holds the last known value, because a network failure does not mean what is on screen
became wrong — only that it could not be confirmed. Render both, or ignore one:

```tsx
if (this.user.isError && this.user.data) {
  return <p>{this.user.data.name} <small>could not refresh</small></p>;
}
```

## When the failure means the page cannot be shown

Sometimes an error is not something to render beside the content — it *is* the answer. Say so
in the render:

```tsx
render() {
  if (this.user.isError) return <NotFound />;
  if (this.user.isPending) return <p>Loading…</p>;
  return <p>{this.user.data!.name}</p>;
}
```

**There is no `throwOnError`**, and that is deliberate rather than missing. Handing a failed
fetch to an [error boundary](/composition/error-boundaries) replaces the whole subtree, which
means unmounting: `@destroyed` runs, cleanups run, local state goes, focus and scroll position
go — and a retry has to rebuild all of it. A failed request is not an unexpected situation.
The network fails routinely, which is why a failure is *state* here and the data you had is
kept. The two lines above unmount exactly what you chose to unmount, and nothing else.

What an app does lose without a boundary is the reminder to handle the error at all — so
development builds report a query that failed while the render never read `isError`, `error`,
`status` or `result` (`RMQ002`).

## Starting with something already in hand

Two options, and the difference between them is the reason both exist.

**`initialData` goes in the cache.** It *is* the answer until something better arrives: every
observer of the key sees it, and staleness applies to it — so with the default `staleTime: 0`
it shows on the first render and is refreshed immediately.

```tsx
{ initialData: cachedTodos, initialDataUpdatedAt: savedAt }
```

Pass `initialDataUpdatedAt` when the data is not new. Without it, seeded data looks freshly
fetched, so a one-minute `staleTime` would keep a value from `localStorage` for a minute
before checking.

**`placeholderData` never touches the cache.** It is a stand-in *this* component shows
instead of a spinner, and it is gone the moment the fetch lands:

```tsx
{ placeholderData: emptyPage }
```

While it shows, `status` is `"success"` and `data` is the stand-in — which is the point, so
that the ordinary `if (isPending) return <Spinner />` gives way to it. `isPlaceholder` is how
you tell: dim it, or hide the actions that would act on nothing. A **failure is never hidden**
by it; a placeholder covers "nothing yet", not "it went wrong".

Both take a function, and it is worth using for anything that is not free to build:
`placeholderData: buildEmpty()` runs the build every time the props callback runs — which for a
query is whenever the key moves — while `placeholderData: buildEmpty` is called once.

## Holding a query back

A query that depends on something not there yet takes `enabled`:

```tsx
private orders = this.use(Query, (self: Panel) => ({
  key: ["orders", self.props.userId],
  fetch: self.load,
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

## Typing the fetcher

`this.use` infers a hook's props from the object you hand it. That works everywhere except one
place: an **inline callback whose parameter you have not annotated**. `fetch: (ctx) => …` asks
TypeScript to infer `ctx` from the same object it is currently inferring — `ctx` is built from the
`key` sitting next to it — so it gives up and hands you `any`:

```tsx expect-error
// `ctx` is implicitly `any`, so `ctx.singal` (typo) passes.
this.use(Query, () => ({ key: ["user", id], fetch: (ctx) => loadUser(id, ctx.signal) }));
```

Pin the type arguments and everything else follows from them:

```tsx
private key = ["user", this.props.id] as const;

private user = this.use(Query<User, typeof this.key>, () => ({
  key: this.key,
  fetch: (ctx) => loadUser(ctx.key[1], ctx.signal),   // ctx.key[1] is the id, typed
}));
```

**Pin both, not just the first.** `Query<User>` alone fixes the `any` — but the key parameter then
falls back to its default, the wide `QueryKey`, so `ctx.key[1]` is `unknown` and the one thing you
reached into `ctx` for is gone.

A method needs no pin, because it carries its own annotation:

```tsx
private user = this.use(Query, () => ({ key: ["user", this.props.id], fetch: this.loadUser }));
```

This is a TypeScript inference limit rather than a rule of this library, so it applies to any hook
whose props include a callback typed from a sibling property —
[`Form<typeof schema>`](/forms#form-typeof-schema-why-the-pin) is the same restriction for the same
reason.

## Reaching the cache directly

For imperative work — prefetching in a parent, invalidating after something happened
outside a mutation — reach the client with `QueryClientAccess`:

```tsx
class Page extends Component {
  private queries = this.use(QueryClientAccess);

  @mounted
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

### `hashKey(key)` and `keyStartsWith(key, prefix)`

The two functions the cache is addressed by, exported for a tool that has to agree with it — a
devtools panel listing entries, a script warming a cache from outside the app.

`hashKey` turns a key into the string the cache is keyed by. **Object keys are sorted**, so
`{ page: 1, tag: "a" }` and `{ tag: "a", page: 1 }` are the same query rather than two — which
matters more than it looks: the server hashes a key, the data travels in the hydration blob, and the
client hashes it again in another process. Disagree by so much as key order and the lookup misses,
the client refetches everything the server already fetched, and the server render bought nothing.
Nothing reports it, because a cache miss looks exactly like a cold start.

`keyStartsWith` is the relation `invalidate(["user"])` uses — whether one key begins with another,
compared part by part through the same hash, so a prefix holding an object still matches.

```ts
import { hashKey, keyStartsWith } from "@ramonda/query";

hashKey(["user", { id: 1, tab: "a" }]) === hashKey(["user", { tab: "a", id: 1 }]);  // true
keyStartsWith(["user", 1, "posts"], ["user", 1]);                                   // true
```

A key may hold anything JSON can carry. That is not a rule invented for the cache — the key crosses
the wire with the data, so it is the same constraint hydration puts on `@state`.

## Next

- [Mutations](/query/mutations) — writing, and rolling back.
