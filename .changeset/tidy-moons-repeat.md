---
"@ramonda/query": minor
---

**Removed `queryOptions`, `mutationOptions` and `infiniteQueryOptions`.** Name the types on
the hook instead — `this.use(Query<Todo>, …)` — which does the same job with nothing to
import.

```tsx
// before
private todo = this.use(Query, (self: TodoCard) =>
  queryOptions({
    key: ["todo", self.props.id] as const,
    fetch: ({ signal, key }) => api.getTodo(key[1], { signal }),
  }),
);

// after
private todo = this.use(Query<Todo, readonly ["todo", number]>, (self: TodoCard) => ({
  key: ["todo", self.props.id] as const,
  fetch: ({ signal, key }) => api.getTodo(key[1], { signal }),
}));
```

The three helpers were identity functions that existed only to give TypeScript a target to
check the props object against, so callbacks beside `fetch` would have contextual types. An
[instantiation expression](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#instantiation-expressions)
(`Query<Todo>`) fixes the props type before the object is read and gets the same result:
`signal`, `key` and `key[1]` are all typed with no annotations, and it compiles away exactly
as the identity call did.

**On a mutation it does more than the helper did.** `Mutation<Todo, string>` types
`mutate`'s own parameter — the one thing `mutationOptions` could never supply, since `TVars`
was inferred from it:

```tsx
private add = this.use(Mutation<Todo, string>, () => ({
  mutate: (title) => api.createTodo(title),                    // title: string
  onSuccess: (todo, title, { client }) => client.invalidate(["todos"]),
}));
```

The inferred form is unchanged and still the shortest thing for a query with one callback:
`this.use(Query, () => ({ key, fetch: ({ signal }: FetchContext) => … }))`.

**One thing is lost, and it was never documented.** Passed as an argument, the options object
got an excess-property check, so a misspelled `staleTimee: 10` was an error. Returned from the
props callback it is not — measured across all three forms, including the annotated one that
14 of the 204 call sites in this repo were not using anyway. A misspelled option is now
silently ignored rather than rejected.
