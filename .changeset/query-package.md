---
"@ramonda/query": minor
---

New package: `@ramonda/query` — cached, deduplicated, race-free async state.

`Query` and `Mutation` are hooks, so they add no element and work inside a `<tr>` or a `<select>`. The cache belongs to a `QueryClientProvider` and reaches components through context; there is no module-level client, because query data is per-request state and a module is shared by every request a server handles at once.

```tsx
private user = this.use(Query, (self: UserCard) => ({
  key: ["user", self.props.id],
  fetch: ({ signal }: FetchContext) => api.getUser(self.props.id, { signal }),
}));
```

- **Server rendering needs no wiring.** Each observer's answer travels in its own `@state`, which core already serializes and restores before the first client render — so the page hydrates with the server's data and does not refetch it. `dehydrate`/`hydrate` are exported for a server that would rather send the cache once.
- **One request per key**, whoever asks and however many times.
- **Race-free**: a changed key, a manual `setData`, or the last observer leaving abandons the request it supersedes, and an abandoned response cannot land over newer data.
- **Triggers**: `staleTime`, `gcTime`, `retry` with backoff, `refetchOnMount`, window focus, reconnect, and `refetchInterval` — per query or as provider defaults.
- **Mutations** with optimistic updates whose rollback is the function `onMutate` returns, matching `@effect`'s cleanup contract.
