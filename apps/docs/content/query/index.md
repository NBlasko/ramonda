---
title: Async data
description: Cached, deduplicated, race-free queries — and data that survives a server render with nothing to wire up.
section: Async data
order: 93
---

# Async data

A component that fetches on mount works, and it is the first thing
[async on the server](/ssr/async) shows you. What it does not do is share: two
components asking for the same thing make two requests, going back to a page fetches
it all again, and every one of them has to spell out loading, error and refresh by
hand.

`@ramonda/query` is that, once, for the whole tree.

```sh
pnpm add @ramonda/query
```

```tsx
import { Component } from "@ramonda/core";
import { Query, QueryClientProvider } from "@ramonda/query";
import type { FetchContext } from "@ramonda/query";

class App extends Component {
  private query = this.use(QueryClientProvider);

  render() {
    return <UserCard id="42" />;
  }
}

class UserCard extends Component<{ id: string }> {
  private user = this.use(Query, (self: UserCard) => ({
    key: ["user", self.props.id],
    fetch: self.load,
  }));

  load({ signal }: FetchContext) {
    return api.getUser(this.props.id, { signal });
  }

  render() {
    if (this.user.isPending) return <p>Loading…</p>;
    if (this.user.isError) return <p>Could not load this user.</p>;
    return <p>{this.user.data?.name}</p>;
  }
}
```

Nothing declares the data's type — `TData` comes from `fetch`, so `this.user.data` is
`User | undefined` on its own.

```demo:QueryDemo
```

Switch between people and watch the request counter: the second visit to someone you
already viewed makes no request, and showing two cards of the same person makes one.

## What it gives you

- **One request per key.** Three components asking for `["user", 7]` in one render
  make one request and cannot disagree about the answer.
- **Cached, so going back is instant.** The data is shown immediately and refreshed
  in the background when it is stale.
- **[Server rendering](/query/server) with nothing to wire up.** The data travels to
  the client inside the hook's own `@state`, which the framework already serializes
  — no `dehydrate()` call, no boundary component, no script tag. The first client
  render shows what the server rendered, and does not fetch it again.
- **Race-free.** A key that changes, a manual write, an observer that unmounts —
  each abandons the request it supersedes, and an abandoned response can never land
  over newer data.
- **[Mutations](/query/mutations)** with optimistic updates whose rollback is
  the function you return.

## The cache belongs to the tree

There is no client to import from module scope. Query data is per-request state —
whose user, whose permissions — and on a server one module is shared by every request
in flight at once, so a global cache would hand one visitor's data to another:
intermittently, invisibly in development where you test one request at a time, and
only under real traffic.

So a `QueryClientProvider` owns the cache and it reaches components through
[context](/composition/context), exactly as [the router](/routing) owns route state.
It is a hook, not a component, for the reason every provider here is a hook: a
component is [always exactly one element](/why/one-element), so a wrapper would cost
a node that means nothing — and inside a `<tr>` or a `<select>` that node is illegal
HTML.

```tsx
class App extends Component {
  private query = this.use(QueryClientProvider, () => ({
    defaults: { staleTime: 30_000, retry: 2 },
  }));
  // …
}
```

`defaults` apply to every query in the tree that does not set its own.

## Typing the callbacks

`TData` is inferred from `fetch`, but the props object is what the type is inferred
**from** — so a callback parameter left unannotated has no contextual type:

```tsx
fetch: ({ signal }) => api.getUser(id, { signal })
// ✗ 'signal' implicitly has an 'any' type
```

Two ways out. Annotate it, which is one word:

```tsx
fetch: ({ signal }: FetchContext) => api.getUser(id, { signal })
```

Or name the data type on the hook itself, which reverses the direction — the object is
then checked against a target type, so every parameter is typed, `key` included:

```tsx
private todo = this.use(Query<Todo, readonly ["todo", number]>, (self: TodoCard) => ({
  key: ["todo", self.props.id] as const,
  fetch: ({ signal, key }) => api.getTodo(key[1], { signal }),  // both typed
}));
```

`Query<Todo>` is ordinary TypeScript — an [instantiation
expression](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#instantiation-expressions),
which names a generic class's type arguments without calling it. It compiles away entirely.

Naming the type does the most work on a **mutation**, where `onSuccess`, `onerror` and
`onSettled` would each need an annotation otherwise — and where it types `mutate`'s own
parameter, which nothing else can do:

```tsx
private add = this.use(Mutation<Todo, string>, () => ({
  mutate: (title) => api.createTodo(title),                 // title is a string
  onSuccess: (todo, title, { client }) => client.invalidate(["todos"]),
}));
```

One thing the annotated form still has over it: an unknown property in the options object
(`staleTimee: 10`) is caught in neither form, because the object is returned from the
callback rather than passed as an argument. Watch the spelling of an option that seems to
do nothing.

## Seeing the cache

With [`@ramonda/devtools`](/guide/installation) installed, the panel grows a **QUERY** tab
listing every entry: the key, the status, how many components are watching, how long ago the
data arrived, a preview of it, and whether it came from the server.

Two actions per row. **invalidate** marks the entry stale and asks whoever is watching to
refresh — the same thing a mutation's `invalidates` does. **remove** throws the data away;
if something is still watching that key it starts over, and if nothing is, the row goes.

There is no refetch button, and that is the design rather than an omission: the **fetcher
belongs to the observer**, not to the cache, so a query nobody is watching has no function
to call. `invalidate` is the honest equivalent.

The tab reads the cache only while it is open, and it is stripped from a production build
along with the rest of the development machinery — an entry with `0 observers · waiting for
gc` is the state worth knowing about, and it is the one people ask a panel for.

## Next

- [Queries](/query/queries) — keys, staleness, and when it refetches.
- [Mutations](/query/mutations) — writing, optimistically.
- [On the server](/query/server) — what crosses the boundary, and how.
- [Testing queries](/query/testing) — which of `act` and `waitFor`, and why a fresh client per test.
