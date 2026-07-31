# @ramonda/query 🌸

Async state for [Ramonda](https://ramonda.pages.dev): cached, deduplicated,
race-free queries and mutations that survive a server render.

> **Status: early.** Versions are `0.0.x` and the API is still moving.

```tsx
import { Component } from "@ramonda/core";
import { Query, QueryClientProvider } from "@ramonda/query";
import type { FetchContext } from "@ramonda/query";

class App extends Component {
  private query = this.use(QueryClientProvider, () => ({
    defaults: { staleTime: 30_000 },
  }));

  render() {
    return <UserCard id="42" />;
  }
}

class UserCard extends Component<{ id: string }> {
  private user = this.use(Query, (self: UserCard) => ({
    key: ["user", self.props.id],
    fetch: ({ signal }: FetchContext) => api.getUser(self.props.id, { signal }),
  }));

  render() {
    if (this.user.isPending) return <p>Loading…</p>;
    if (this.user.isError) return <p>Could not load this user.</p>;
    return <p>{this.user.data?.name}</p>;
  }
}
```

`TData` comes from `fetch` — nothing is declared at the call site.

## What it does

- **One request per key.** Three components asking for `["user", 7]` in one render
  make one request and cannot disagree about the answer.
- **Server rendering with no wiring.** A query's data travels to the client inside
  the hook's own `@state`, which core already serializes — so there is no
  `dehydrate()` to call, no boundary component, and no script tag to place. The
  first client render shows what the server rendered, and does not fetch it again.
- **Race-free.** A key that changes, a manual write, an observer that unmounts —
  each abandons the request it supersedes, and an abandoned response can never
  land over newer data.
- **Stale-while-revalidate.** Cached data is shown immediately and refreshed in the
  background. A failed refresh keeps the last known value on screen rather than
  blanking it to prove the network broke.
- **Triggers you can turn off.** Window focus and reconnect refresh only STALE
  data; `refetchInterval` polls; all three are options, on the query or on the
  provider.
- **Mutations with rollback.** `onMutate` returns the undo, and it runs if the
  write fails — the only place in Ramonda where returning a function means
  "call this later", because here the later is a specific event rather than
  an unspecified teardown.

## The cache belongs to the tree

There is no global client to import. Query data is per-request state — whose user,
whose permissions — and a module is shared by every request a server handles at
once, so a module-level cache would serve one visitor's data to another:
intermittently, invisibly in development, and only under real traffic. So a
`QueryClientProvider` owns the cache and it reaches components through context,
exactly as [the router](../router) owns route state.

## Typing the callbacks

`this.use(Query, () => ({ … }))` infers `TData` from `fetch`, but the props object
is what the type is inferred FROM — so a callback parameter left unannotated has no
contextual type. Either annotate it, as above, or pass the options through the
helper and get every parameter typed:

```tsx
import { queryOptions } from "@ramonda/query";

private todo = this.use(Query, (self: TodoCard) =>
  queryOptions({
    key: ["todo", self.props.id] as const,
    fetch: ({ signal, key }) => api.getTodo(key[1], { signal }),  // both typed
  }),
);
```

`mutationOptions` does the same for a mutation, where it earns its keep sooner —
`onSuccess`, `onError` and `onSettled` would each need an annotation otherwise.

## Mutations

```tsx
class AddTodo extends Component {
  private add = this.use(Mutation, () =>
    mutationOptions({
      mutate: (title: string) => api.createTodo(title),
      onMutate: (title, { client }) => {
        const previous = client.peek<Todo[]>(["todos"])?.data;
        client.setData<Todo[]>(["todos"], (todos) => [...(todos ?? []), draft(title)]);
        return () => client.setData(["todos"], previous);   // the rollback
      },
      invalidates: [["todos"]],
    }),
  );

  render() {
    return <button disabled={this.add.isPending}>Add</button>;
  }
}
```

`mutate` never rejects — the failure is `this.add.error`, so a click handler does
not have to catch. `mutateAsync` rejects, for a caller that needs to know.

## Options

| Option | Default | What it does |
|---|---|---|
| `staleTime` | `0` | How long data counts as fresh |
| `gcTime` | `5 min` | How long an unwatched entry is kept |
| `retry` | `3` | Attempts after the first failure; a predicate decides per error |
| `retryDelay` | backoff | `1s, 2s, 4s…` capped at 30s |
| `refetchOnMount` | `"stale"` | `"always"` \| `false` — data from the server counts as fresh |
| `refetchOnWindowFocus` | `true` | Refresh stale data when the tab regains focus |
| `refetchOnReconnect` | `true` | Refresh stale data when the browser comes back online |
| `refetchInterval` | off | Poll every N ms, staleness ignored |
| `enabled` | `true` | Hold the query back — better than a key with a hole in it |

Set them on a query, or on the provider as `defaults` for the whole tree.

## License

[MIT](../../LICENSE) © Nikola Blagojević
