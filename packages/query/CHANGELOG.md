# @ramonda/query

## 0.2.0

### Minor Changes

- 63d84cb: A query only re-renders its owner for the parts the owner actually reads.

  A cache entry changes three times per refetch — the fetch starts, the data arrives, the
  freshness moves — and each one used to wake the owner. Measured on a query whose rendered
  value never changed: **three refetches, nine renders.** Two of every three were for facts
  the component never asked about.

  The getters record which facet was read (data, status, error, fetchStatus, failureCount,
  updatedAt, restored), and a notification compares only those. Same shape TanStack and SWR
  arrived at by proxying their result object; here the getters are already the access points,
  so a bit per facet is enough. Measured after: a component reading one field is woken **once
  per refetch** instead of three times, and a component that reads `isFetching` still gets
  every transition, because reading it subscribes to it.

  **The read set never shrinks**, deliberately: a component that reads `isFetching` inside a
  branch would otherwise stop being woken the moment the branch is not taken, and would show a
  stale spinner the next time it is. Accumulating errs towards more renders, which is the safe
  direction.

  `data` and `error` are compared by identity, because that is what the cache guarantees — it
  REPLACES `data` when a fetch lands, so a refetch returning an equal-but-new object still
  counts as a change. Closing that last gap is what `select` or structural sharing would be
  for, and this deliberately is not that: it is the part that needs no new API.

  **RMQ002's question changed with it, and improved.** It asked "did this render look at the
  failure"; it now asks "does this reader ever look", using the same read set. It had to
  change: a query read only through `data` fails, changes nothing visible, and is no longer
  woken — so a render-based check could not see it either. The new question is the better one
  anyway, since a component that has read `isError` once demonstrably has the branch.

  Five tests hold the counts, including two that would catch an over-eager gate: the first
  paint is never skipped (nothing has been read yet, so everything counts), and the
  component's own state changes still render.

- 4dab8ea: Every value in the panel is a collapsible tree, and any of them opens on the whole panel.

  The one-line preview was raised twice — 120 → 2000 for a query, 200 → 8000 for state and props —
  and the ellipsis came back both times. The sizes that matter are not near any cap: an infinite
  query holding eight pages of products is a hundred kilobytes, and no line length makes that
  readable. Length was never the problem; structure was.

  So a value renders the way a browser renders one: keys and types coloured, containers labelled by
  size (`pages: Array(8)`), everything past the first level collapsed until you open it. `⤢` on any
  row opens that value on the whole panel, where it can be scrolled, switched to pretty-printed JSON,
  and copied. This applies everywhere — state, a hook's props, a component's props, a query's data.

  Two limits, and it takes both: a node budget bounds the width, a depth cap bounds the recursion,
  and a cycle is named as `[circular]` rather than truncated. Whatever is dropped says so in the row
  where it was dropped.

  `@ramonda/query`'s bridge now sends the cached value as a bounded **copy** rather than a preview
  string, so the panel cannot hold the app's objects alive or mutate them. Two related fixes fell
  out: the Query list's change signal moved from the preview to `updatedAt` — a preview is capped, so
  appending an eighth page changed nothing within the cap and the panel went on showing the seventh —
  and the panel's value-patching path looks its element up in a Map instead of a
  `[data-sv="…"]` selector, because a prop name can carry a quote, which is exactly the bug that made
  the query hash throw on every poll.

- dd24e3e: `initialData` and `placeholderData`, and `client.seed()` under the first one.

  The difference between them is the reason both exist, so it is stated everywhere they appear:

  - **`initialData` goes in the cache.** It IS the answer until something better arrives — every
    observer of the key sees it, and staleness applies, so with the default `staleTime: 0` it
    shows on the first render and is refreshed at once. `initialDataUpdatedAt` says when it was
    actually obtained: without it, a value from `localStorage` looks freshly fetched and a long
    `staleTime` keeps it.
  - **`placeholderData` never touches the cache.** It is a stand-in one component shows instead
    of a spinner, and it is gone the moment the fetch lands.

  Both accept a function, and it matters more here than it looks: the props callback runs on
  every render of the owner, so an inline value is rebuilt every render for the one render that
  needs it. The function form is called once, when the value is actually wanted.

  **`client.seed(key, data, updatedAt?)`** is the write `initialData` needed and `setData` could
  not be. `setData` is an assertion — this is the value now — and cancels a fetch in flight;
  `seed` is an offer: use this if you have nothing. So an answer that was fetched, or restored
  from a server render, outranks one the app had lying around, and two observers arriving with
  their own `initialData` cannot fight over the entry. Seeding happens from `rekey`, so it also
  covers a key MOVING: a new key is a new question, and initial data for it should show rather
  than a spinner.

  **While a placeholder shows, `status` is `"success"`.** That is deliberate: the whole purpose is
  that `if (isPending) return <Spinner />` gives way to the stand-in. `isPlaceholder` tells the
  two apart. A failure is never hidden — a placeholder covers "nothing yet", not "it went wrong",
  or the failure would be invisible and RMQ002 would be its only trace.

  A test caught the inconsistency that comes with that decision: `isPending`, `isSuccess` and
  `isError` read the entry directly, so they disagreed with the `status` they are shorthand for.
  They delegate to it now — the same trap `result` had already shown.

- 977cc9c: `@ramonda/core` is a **peer** dependency of query and router, not a regular one.

  The build already treated it that way — both tsup configs mark it `external`, and the reason
  is written next to it: one copy of the framework, or the hook a component uses is not the
  hook the app rendered. Core holds module-level state (the update queue, the reactive
  context), so two copies is not a duplicate, it is two frameworks that cannot see each
  other. The manifest now says what the build has been doing, so the package manager enforces
  it instead of leaving it to luck.

  It worked by luck until now: `dependencies: { "@ramonda/core": "^0.1.0" }` dedupes to one
  copy as long as the app's range agrees. A range that does not agree — an app pinned to
  0.1.0 with query resolving 0.2.0, or the reverse — installs both, and the failure is a
  component extending a different `Component` than the one rendering it. The docs app's vitest
  config carries a measurement of exactly that.

  The range is `>=0.1.0 <1.0.0`, spanning the whole pre-1.0 line rather than `^0.1.0`. This is
  the trap `@ramonda/testing-library` fell into: a caret on a 0.x version expires on the next
  minor, and a peer dependency going out of range is correctly a MAJOR for the dependent — a
  0.0.x test helper was about to become 1.0.0 for that reason alone. `.changeset/config.json`
  already carries `onlyUpdatePeerDependentsWhenOutOfRange` from that fix, so the two work
  together: `changeset status` reports no major.

  npm 7+ and pnpm install peers automatically, so nothing changes for a consumer beyond
  getting the guarantee.

- 5883bbd: `RMQ002` — a query failed and the render never looked. And deliberately no `throwOnError`.

  The option other libraries have rethrows a failure so an error boundary catches it. It is not
  built here, and the reason is what a boundary DOES: it replaces the subtree, which means
  unmounting — `@destroy`, cleanups, local state, focus, scroll position — and a retry then has
  to rebuild all of it. A failed fetch is not an unexpected situation; the network fails
  routinely, which is why `Query` models a failure as state and keeps the data it had. Handing
  that to a boundary punishes the reader for somebody else's timeout.

  What people actually get from `throwOnError` is _noticing_, and noticing is a diagnostic. So
  in a development build, a query in `error` whose render read none of `isError`, `error`,
  `status` or `result` is reported, with the key and the failure named. It matters because a
  failed refetch keeps its data: the page looks healthy while showing values nobody can refresh.

  Judged per render — the flag is cleared after each check, so a component that showed the error
  and then stopped (a collapsed panel, a switched tab) is reported again rather than excused by
  an earlier render.

  Two details worth recording. The check reads the ATTACHED entry rather than
  `peek(this.props.key)`, because peeking hashes the key and this runs after every render — the
  first version undid the identity fast path (723 ns → 31 ns) and the test that holds it failed
  immediately. And it runs from `@updated` _and_ `@mount`: an error restored from a server render
  is already on screen at the first paint, with no second render for `@updated` to follow.

  Also: `/query/queries` gains the pattern for a failure that means the page cannot be shown —
  `if (this.user.isError) return <NotFound />` — which unmounts exactly what the app chose to,
  and nothing else.

- 4a3b299: Structural sharing, on by default: an answer equal to the one already held IS the one already
  held.

  A fetch replaces `entry.data` with whatever the fetcher returned — a fresh object every time,
  even when the bytes are identical — so every poll looked like a change and re-rendered every
  observer. Measured in jsdom, the comparison against the render it prevents, on rows of six
  fields:

  ```
    rows   deep compare   JSON.stringify   render + DOM commit
    10        28 µs           28 µs             5.4 ms
    100      137 µs          136 µs            26 ms
    1000     811 µs        1 287 µs           272 ms
  ```

  The commit is 190–335× the comparison, so the trade is not close. jsdom is not a browser —
  no layout, no paint, slower nodes — but nothing plausible closes two orders of magnitude. With
  sharing on, the same benchmark does **31 equal writes for zero renders**, where before it did 31.

  **It rebuilds rather than answering yes or no**, which costs the same walk and buys the harder
  case too: every unchanged SUBSTRUCTURE keeps its identity, and `list()` reuses an item's scope
  when `existing.item === item` — so a response where one row moved re-renders one row instead
  of all of them. There is a test for exactly that: five rows, one changed, one row render.

  **Two bounds, and it takes both.** A node budget for width and a depth cap for recursion. The
  budget alone was the first version, and a test killed it: a cyclic response recurses one frame
  per visit, so it blew the call stack long before 20 000 visits. Past either bound the new value
  is returned as-is — the safe direction, since an unnecessary render costs a frame while a
  missed one shows stale data forever.

  Only arrays and plain objects are traversed. A `Date`, a `Map`, a class instance — anything
  with a prototype of its own — is compared by identity, because equality for those is the app's
  business and guessing it wrong is worse than a render.

  `structuralSharing: false` turns it off, per query or as a provider default, for a payload
  that is always different and large enough for the walk to be pure cost.

  This is the layer that finishes what access tracking started: tracking removed the renders for
  facts the component never read, and this removes the ones where the data itself did not
  actually change. What is left — "the data changed but the slice I use did not" — is what
  `select` would be for, and it is now the only thing left for it to do.

- 6202472: The focus trigger watches `document.visibilityState` instead of the window's `focus` event.
  `refetchOnWindowFocus` keeps its name.

  `focus` was wrong in both directions:

  - **It missed.** On a phone, leaving the browser and coming back reliably fires
    `visibilitychange`, while `focus` and `blur` are unreliable — so the reader returned to stale
    data and nothing refreshed it.
  - **It over-fired.** A page visible the whole time — a second monitor, a split screen, or
    DevTools holding focus — fires `focus` when you click into it, though nothing was ever hidden.
    With the default `staleTime: 0` that was a request per click into the window.

  `document.visibilityState` answers what the option is actually asking: is somebody looking at
  this again. TanStack reached the same conclusion and dropped its focus listener.

  **The behaviour change, stated plainly:** clicking into an already-visible window no longer
  refetches. There is a test asserting exactly that, so nobody has to wonder later whether it was
  intentional.

  The option keeps the name `refetchOnWindowFocus` because that is the name people arrive with,
  and it still describes the intent even where it no longer describes the mechanism. Renaming
  would cost every reader a lookup to learn that nothing about their app changed.

  `@onDocument("visibilitychange")`, since the event fires on the document — and like `@onWindow`
  it is built on an effect, so it attaches on the client only and is removed on destroy.

### Patch Changes

- 25a613c: A `@compute` that reads a query now follows it, instead of freezing on the first value it saw.

  The failure was silent and total. The cache is not reactive — an entry is a plain object, and
  what wakes an observer is the `version` increment in `notify`. A render re-reads `data`,
  `status` and the rest on every pass, so it always looked correct; a `@compute` caches, and a
  compute that read no signal is never invalidated. Measured:

  ```
  @compute get name() { return this.user.data?.name }   // "—", forever
  this.user.data?.name                                   // "Ada 4"
  ```

  The compute had cached `undefined` from before the data arrived and never looked again.

  One signal read inside the `entry` getter fixes it, so every reader — render, compute,
  watcher — depends on the one thing that changes when the entry does. It costs no extra render,
  which is the point of using the version signal rather than adding another: that increment IS
  the wake-up, so there is nothing else to schedule. Verified — one unrelated state change still
  produces exactly one render.

  Found while asking whether `select` needs to exist or whether a `@compute` over `data` is
  enough. It was not enough, for a reason that had nothing to do with `select`.

- 2562896: A context consumer is no longer an empty node in devtools, and the pair is named Provider/Consumer
  throughout.

  **What a consumer reads is now visible.** A consumer holds no state and no props — every value it
  exposes is an accessor over the provider's signals — so it appeared in the panel as a node with
  nothing in it: the emptiest thing in the tree being the hook whose entire job is reading. It now
  reports, under `Reads from context`, the keys it is subscribed to with their current values, and
  names the keys it has never read.

  The catch, and the reason the consumer answers for itself rather than the panel walking its
  properties: **reading is subscribing.** A consumer's getter attaches a listener on first read, so a
  panel that read every key would silently widen what the owning component re-renders on. Only
  already-subscribed keys are read, where the subscribe branch is a no-op. There is a test that
  changes a key the consumer never reads and asserts it did not rebuild — inspecting must not change
  behaviour, and here the ordinary read does.

  Seeing which keys a consumer actually reads is worth it on its own: it is the fine-grained
  subscription made visible, the difference between "this one wakes on `color`" and "on anything in
  the theme".

  **Naming.** The docs already destructured `[ThemeProvider, ThemeConsumer]` while the framework's own
  source, tests and playground said `ThemeContext` — and devtools, which labels the hook
  `${label}Consumer`, disagreed with the code in front of you. `Consumer` everywhere now. It is also
  the more accurate name: the pair is a provider and a consumer, and unlike React's context object
  there is nothing here to take a `.Provider` off. Only local destructuring names changed; no API did.

- b04c39b: The Query tab's buttons did nothing, and the panel is resizable now.

  **Attribute values were never escaped for quotes.** A query's hash is JSON, so it carries `"` —
  and `data-q-hash="["products"]"` ends the attribute at the second quote. The parser then read the
  rest as bare attributes, leaving `dataset.qHash` as `[`, so **invalidate and remove looked up an
  entry that cannot exist and silently did nothing**. The same broken markup is why the age element
  could not be found, and why `refreshAges` threw
  `Failed to execute 'querySelector': not a valid selector` four times a second — one missing
  escape, three symptoms. `escapeHtml` covers `"` and `'` now, and the ages are matched through
  `dataset` in JS rather than through a selector built from data.

  **A query's data preview is capped at 2000 characters instead of 120.** 120 showed
  `{"products":[{"id":1,"title":"Essence Masc…` and stopped there, which tells you nothing the key
  did not. Both a preview and a state value scroll inside their own box now, so the cap only keeps
  a megabyte of cached data off the wire.

  **The panel opens at 620px and its left edge is a drag handle.** (It was a fixed 450px, set before
  the panel had a nested component tree and a query table in it — both wide, both wrapping into
  unreadable columns. 900px was tried in between and covered too much of the app.) The width is remembered across reloads and
  clamped to 280px…96vw: no fixed default can be right for both a query table and a narrow highlight
  check, so it is the reader's to set. The
  content scrolls on both axes, a tree row no longer wraps, and the toolbar reflows through a
  **container** query — the panel's width is dragged, not the window's, so a media query would
  never fire.

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
