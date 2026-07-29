# @ramonda/query

## 0.1.0

### Minor Changes

- ee6adb0: `InfiniteQuery` — pages under one key.

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

- 124d210: RMD023, `static StableProps`, and `each` that takes nothing.

  **RMD023 — components built from an array with no keys.** The check RMD020 cannot make: a
  mapper is handed to `Array.prototype.map` and never stored anywhere a comparison can reach,
  and its output is a run of freshly built vnodes, which is what all JSX looks like. Structure
  is the only evidence — JSX passes children as separate arguments, so a nested array among
  them was built by an expression. `normalizeChildren` brands its own arrays (DEV only) so
  `{this.props.children}` is not mistaken for a mapped one.

  Narrowed twice, and the history is the reason to trust it. Reporting every raw array broke
  10 of core's own tests, all exercising child groups on purpose — a mapped array is a
  supported shape here, with its own key space. What ships reports only what is genuinely
  unhandled: two or more UNKEYED COMPONENT rows, whose identity is their position, so
  inserting or removing anywhere but the end moves state and DOM to the wrong item. Plain
  markup is not reported (the diff patches it and the result is correct), keyed children are
  not reported, forwarded children are not reported.

  **`static StableProps` — the hook declares which props are values, so the call site does
  not.** A query key is a value: `["user", 7]` built again is the same question, and that is
  the hook's knowledge rather than something every component using it should encode. `Query`
  declares `key`, `Mutation` declares `invalidates`, and the framework hands back one identity
  for as long as the contents are equal:

  ```tsx
  key: ["user", self.props.id]; // a plain literal; nothing to wrap
  ```

  `stable()` stays for the other direction — a hook you do not own that declared nothing. A
  declaration cannot cover a function prop: two closures with the same body are not equal by
  any comparison that is safe to make, so a listed function is left alone and still reported.

  **`each` accepts `null` and `undefined`** and renders nothing for them. The list engine
  already handled it; only the type forbade it. This removes the `?? []` that every "data has
  not arrived yet" list was writing — a fresh empty array on every render, which cost the list
  its item scopes and was itself reported by RMD020.

  **Documentation: what a hook author cannot assume.** A reusable hook is written against what
  it might be handed, not against a well-behaved caller — it does not know when it will be
  called, whether a value is the same object as last time, what the value is, or whether the
  diagnostics are even running. So: compare by value what is a value, and be idempotent about
  the rest. `Query.onKeyChanged` is the worked example, comparing the key itself even though
  the framework already did.

- d69cf21: A QUERY tab in the devtools panel.

  Every entry in every live cache: the key, status and fetch status, how many components are
  watching, how long ago the data arrived, a preview of it, the failure count, and whether it
  came from a server render. Per row, **invalidate** (mark stale and ask whoever is watching to
  refresh) and **remove** (throw the data away).

  **No refetch button**, and that is the design rather than an omission: the fetcher belongs to
  the observer, not to the cache, so a query nobody is watching has no function to call.
  `invalidate` is the honest equivalent — the same thing a mutation's `invalidates` does.

  **Pull, not push.** The panel is a custom element outside the tree, so it cannot see a
  provider; `@ramonda/query` installs `__RAMONDA_QUERY__` in a development build and the panel
  calls it while its tab is open, four times a second, and not at all otherwise. That is the
  model core already uses for `__RAMONDA_INSPECT__`, and the reason is the same: a cache changes
  on every fetch, every observer arriving and leaving, every invalidate and every sweep, and
  pushing all of that into a panel nobody is looking at would cost something in every
  development build.

  **Providers register, clients do not.** A client belongs to a provider and there can be
  several, so registration happens in the provider's `@create` (client only — a server render
  has no panel, and `@destroy` never runs there) and is undone in `@destroy`. A torn-down tree
  therefore takes its cache out of the list, so the panel cannot hold one alive or show one
  that no longer exists.

  Ten tests on the bridge, plus one in the production run asserting the global is never
  installed. Two of them are notes rather than checks: `remove` on a key something is still
  watching does not make the row vanish — the observer re-subscribes onto a fresh entry and
  fetches again, because `remove` notifies observers with `"removed"` exactly so they stop
  rendering something deleted — and a row whose entry was collected between being drawn and
  being clicked is looked up fresh, so an action on it does nothing instead of throwing.

  One finding recorded in the code: `@create` ignores what it returns. A teardown returned from
  it is silently dropped — that contract belongs to `@effect` and `createSubscriptionDecorator` —
  so the registry grew by one per test until the two halves were written out as `@create` plus
  `@destroy`.

- 465918f: New package: `@ramonda/query` — cached, deduplicated, race-free async state.

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

### Patch Changes

- b208b86: `_`-prefixed methods are bound like any other, `@Host` infers its class, and class
  decorators are PascalCase.

  **Method binding no longer skips `_`-prefixed methods.** The skip was a performance
  opt-out — internal by convention, so binding was not paid for it — and the convention is
  not this framework's to claim. typescript-eslint's `naming-convention` rule is commonly
  configured with `leadingUnderscore: "require"` for private members, so a project with that
  rule wrote `private _apply()` and got a method that silently did not bind:
  `onClick={this._apply}` then lost `this`, with no error and no diagnostic. A lint rule
  chosen for unrelated reasons broke the framework's central promise about methods.

  Nothing internal needed it, which was checked rather than assumed: there are no
  `_`-prefixed members on `Component.prototype` or `Hook.prototype`, `_componentInstance` and
  `_componentDefinition` live on DOM nodes, and `Context`'s `_subscribedKeys` is a field —
  fields are never bound. (The comment justifying the skip pointed at "the note in
  Component.ts". There was no such note.)

  And it bought little. Measured per instance, binding every method against binding all but a
  third of them: 3 methods 41 ns, 5 methods 10 ns, 8 methods 84 ns, 12 methods 212 ns — a
  fifth of a millisecond across a thousand rows, at twelve methods. If an opt-out is wanted
  back it should be an explicit `@unbound` decorator, which says what it does where it does
  it and cannot be triggered by a lint rule.

  **`@Host` needs no type annotation and no type argument.** `self` in its props callback, and
  `props` in its tag callback, are now typed from the decorated class:

  ```tsx
  @Host("section", (self) => ({ "data-label": self.label })) // self is Card
  class Card extends Component<{ label: string }> {}
  ```

  The mechanism is worth recording: both parameter types are CONDITIONAL types over the class
  (`InstanceOf<C>`, `PropsOf<C>`), and a conditional is not an inference site — so TypeScript
  cannot resolve `C` from the decorator's arguments and defers until the decorator is applied,
  where the class supplies it. The obvious shape (a type parameter sitting directly in the
  callback's parameter position) fixes it to `unknown` from an unannotated arrow before the
  class is ever looked at, which is why this used to need `(self: Card)` spelled out.

  **`@stableProps` is renamed `@StableProps`** — class decorators are PascalCase (`@Host`,
  `@StableProps`), member decorators are camelCase (`@state`, `@compute`, `@watchProp`). The
  casing is the only thing that tells you where a decorator goes, and the two groups are used
  in different places. Documented in the API reference.

- c166868: **BREAKING: `@effect` is removed.** Every case it served has a decorator that says what it
  is for, and having one that said nothing was what made circular updates easy to write.

  Where each case went:

  | what the effect was doing        | what to use                                                                                                                     |
  | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | subscribing to something outside | `createSubscriptionDecorator` — same "return the cleanup" contract, and it re-connects when a signal its `connect` READ changes |
  | reading the DOM after the commit | `@updated`                                                                                                                      |
  | reacting to a prop               | `@watchProp`                                                                                                                    |
  | deriving a value                 | `@compute`                                                                                                                      |

  The machinery is untouched. `attachEffect` still runs the queue after the DOM work, and
  `createSubscriptionDecorator`, `@onElement`, `@onWindow`, `@onDocument`, `@interval`,
  `@timeout` and `@deferHydration` are all still built on it. What went is the door that
  handed the raw body through with no contract about what it returned.

  **Why, in one sentence:** an effect was whichever of those four it happened to be, decided
  by what its body read — so two of them writing what the other read re-triggered each other,
  and nothing could name the cause. RMD009 caught the loop but could only say "this component
  rebuilt 50 times", and its fix text had to guess. Naming what a piece of code is for is what
  lets the framework say something useful when it goes wrong, and makes the ordering knowable
  instead of emergent.

  `Head` was the framework's own last user, and the migration made it smaller: as a
  `@watchProp` whose selector returns a serialized form, the comparison is by value for free
  and the `appliedSnapshot` guard field is gone. That guard only existed because effects run
  child→parent while `@create` runs parent→child, so an effect handed a nested route's title
  back to its layout on the first commit. A `@watchProp` runs in the same order as `@create`
  and does not fire on mount, so both halves agree and the deeper `Head` wins.

  Also in this release, from the same pass:

  - The docs page `/concepts/effects` is now `/concepts/subscriptions`, and it states what
    each of the four replacements is for and when it runs.
  - RMD009's, RMD008's, RMD011's and RMD019's fix texts named `@effect` as the usual cause;
    they now name `@updated` and subscriptions, with the line that matters spelled out — a
    post-render write must CONVERGE, because assigning the same value is not a change and
    schedules nothing.
  - Tests of the shared machinery kept their coverage through a harness in `src/test/`
    (`effectLike`), which is `createSubscriptionDecorator` with the decorated method as the
    whole connect. It lives in `test/` on purpose: it is a way of saying "an effect, unnamed",
    which is the thing that was removed.

- 9e87633: `@watchProp`'s selector is typed from the class it is on — no annotation, no type argument.

  ```tsx
  @watchProp((props) => props.userId)   // props is UserProps
  reload(next: string, previous: string) {}
  ```

  `props.usreId` is now a compile error where it used to be `unknown` (so anything compiled).
  The mechanism is the same one `@Host` and `@StableProps` use: `This` appears only in the
  decorator CONTEXT and inside a conditional type (`PropsOfInstance<This>`), and a conditional
  is not an inference site — so TypeScript defers it to the application, where the decorated
  class supplies it. The selector's return type still fixes the value type, so the method is
  checked as `(V, V) => void`.

  **Hooks needed one addition to make this work.** `Hook.props` is `protected`, so a
  conditional type reads `never` off it, where `BaseComponent.props` is public. `Hook` now
  carries its props type in a phantom — `declare readonly [PROPS_TYPE]?: R`, symbol-keyed and
  optional, so it emits nothing, collides with nothing, and appears in no autocomplete.

  **What still needs annotating, and why.** The decorated METHOD's parameters. A decorator
  does not contextually type the signature it decorates, so unannotated parameters are an
  implicit `any` (TS7006) — measured, not assumed. That is a TypeScript limitation.

  Annotated selectors keep working when the annotation matches. Three inside `@ramonda/query`
  did not: `(props: QueryProps<unknown>)` on a `Query<TData, K>` is not the same type, and the
  compiler now says so. They are unannotated, which is what the change is for.

- Updated dependencies [b208b86]
- Updated dependencies [465918f]
- Updated dependencies [124d210]
- Updated dependencies [0cab315]
- Updated dependencies [8cedc9b]
- Updated dependencies [c166868]
- Updated dependencies [894b094]
- Updated dependencies [2806fb1]
- Updated dependencies [9e87633]
- Updated dependencies [894b094]
- Updated dependencies [465918f]
  - @ramonda/core@0.1.0
