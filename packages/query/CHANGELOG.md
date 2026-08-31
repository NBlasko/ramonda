# @ramonda/query

## 0.9.2

### Patch Changes

- c468786: A component owns a range of nodes rather than being one element, and `@Host` is gone with the
  element it named.

  A component's markup is what its `render()` returns, and nothing else. One element, several, or
  none — a component that renders `null` has state, a lifecycle and hooks and no nodes at all. So two
  `<td>` from one component sit inside the `<tr>` where an element would be foster-parented out in
  front of the whole table, and a component that exists only to toggle other components costs the page
  nothing.

  The host element was never for the author. It was the diff's ANCHOR, and it charged for that
  everywhere else: the tag was declared away from the markup, `display: contents` removed the box but
  not the node so `.card > p` could not reach through a component, and a component could not produce
  two siblings. The anchor does not have to be a node — `DiffAndMerge`'s ordering pass never searched
  for one, it builds the target order for a block and walks it backwards — so a component is now a
  third kind of `RecordEntry` beside `ListRegion`, and `isRegion` stays blind to which kind.

  **Removed:** `@Host`, `@onElement`, `ref` on a component, and the `<ramonda-host>` element.
  `RMD010`, `RMD042` and `RMD045` leave with the faults they described, and so does `@ramonda/check`'s
  `listener-on-the-default-host`. Write the element in the render, put the listener and the ref on it,
  and give a custom element a dashed tag — `JSX.IntrinsicElements` now accepts one, because `@Host` did.

  **Server markup carries a comment pair per component**, with its state blob on the opening one:
  `<tr><!--c7 {"state":{…}}--><td>…</td><td>…</td><!--/c7--></tr>`. Served markup is text and nothing in
  plain HTML says where one component's run of nodes ends, so the server says it — in comments, because
  a comment is the only thing the parser leaves alone inside a `<tr>`. Hydration consumes and removes
  them, so a hydrated page holds exactly what a client render would have produced, and a client render
  never writes one. The blob moved with them: it used to be `data-ramonda-state` on the host element.

  **Measured, not asserted.** `RenderCost` counts DOM operations, and a list of 200 component rows costs
  what 200 element rows cost — two insertions to append or prepend, two to swap, `N - 1` to reverse,
  nothing for a fresh array of the same rows. An empty component filling in costs what a plain
  conditional hole costs, so the sibling search it has to do costs no DOM operation. The child record is
  kept per region owner rather than per component, so it does not grow with a list.

  `@ramonda/router`'s `Link` writes its `<a>` in the render, where the href and the click handler that
  has to agree with it sit together. `@ramonda/testing-library`'s `renderHook` finds its host through
  the record, and `@ramonda/core/testing` gains `getComponentsIn` for that — which is also the only way
  to find a component that renders nothing, since no node points at one.

- ba680c1: The retired one-element rule stops being taught, including in a message readers see

  `Every JSX tag is exactly one element` was the framework's headline rule and is not
  true any more — a component renders one element, several, or none. The rule was
  retired; the sentences arguing FROM it were not, and they were spread across four
  packages.

  The one that reached users: the fragment error said `<>…</>` is refused because it
  `would make one tag produce several elements`. That is now something a component
  does routinely, so the message argued from a rule the framework no longer has. It
  gives the reason that still holds — a fragment has no state, no lifecycle and no
  identity the diff can hold, and a component covers every case it would.

  The rest were comments and one reference page, each rewritten to the reason that
  survives rather than deleted: `RMD011` and its DEV guard, `__h`'s contract (one
  vnode per tag, which is a claim about the vnode and not about the DOM), why
  `createContext`, `QueryClientProvider` and `Router` are hooks (they put nothing on
  the page — not that a wrapper was forbidden), and why attribute names are not
  aliased.

  Two comments also described `<ramonda-host>`, which no longer exists anywhere in
  the source. `AsyncLoad` renders the loaded module and nothing around it.

  `list()` argued from the rule under a third spelling — "it does not bend the
  one-tag-one-element rule" — which a search for the headline sentence did not reach.
  The reason that survives is why a `<For>` TAG would still be wrong: a tag whose whole
  job is to stand in for N siblings and be nothing itself is a fragment with extra
  steps, and that is the thing Ramonda does not have.

- ccc64fe: Every package's npm page carries the same four facts, and `homepage` points at its own docs

  The README is published, so this is a change to what a reader lands on. Measured before it was
  written: of eleven published packages, five carried no licence, three named no install command
  anywhere, one had no badges, and two linked to no documentation at all. `create-ramonda` and
  `@ramonda/devtools` had no README whatsoever — their npm pages were blank.

  Those facts are now generated from the sources that already held them — the package name, its
  `peerDependencies` (required ones appear in the install line; `bguard` is declared optional and
  so does not), and `homepage`, which now points at the package's own documentation section rather
  than at the site root. npm shows `homepage` beside the package, so that is a better npm page on
  its own as well as the one source the README link is written from.

  Nothing below the generated region changed. Each README keeps its own voice, and its own headings.

## 0.9.1

### Patch Changes

- 5632f32: The documentation is at **ramonda.dev**, and everything that names it says so.

  The site was reachable only at its Cloudflare Pages subdomain, `ramonda.pages.dev`, and that address was
  written into 63 places. The custom domain is attached now, so all of them name it: `homepage` in every
  published `package.json`, every README, the URL a diagnostic tells you to open, the scaffolder's closing
  line, both `create-ramonda` templates, and `BASE` in `apps/docs/src/entry-server.tsx`.

  **`BASE` is the one that mattered beyond tidiness.** Every `canonical`, `og:url`, `og:image` and the
  whole of `sitemap.xml` and `robots.txt` are built from it — its own docblock warned that a move would
  take the canonical tags and leave the sitemap behind. Left alone, every page on the new domain would
  have told a search engine that the real page is on `pages.dev`. Verified on a real build rather than
  assumed: `Sitemap: https://ramonda.dev/sitemap.xml`, `<loc>https://ramonda.dev/…`, and the canonical
  and `og:image` tags on the built pages.

  **Two places deliberately keep the old host.** The CHANGELOGs: those are published release notes, the
  links were correct when they were written, `pages.dev` still resolves, and rewriting them would be
  rewriting history. And `.github/workflows/README.md`, where `ramonda.pages.dev` is a FACT about
  Cloudflare — the project's name is its subdomain — so the sentence stays and gains the one that was
  missing: the site is served at the custom domain, and leaving anything on `pages.dev` is how a search
  engine is told the real page is elsewhere.

## 0.9.0

### Minor Changes

- c542e07: The published graph is `dist/ramonda-graph.json`.

  It used to be `dist/graph.json`. Nothing resolves it by name — an app reads the `ramonda.graph`
  field of the package's `package.json` — so **a package already built to any other path keeps
  working**, and there is nothing to migrate.

  The name changed for where the file ends up. It is PUBLISHED: it sits in a stranger's
  `node_modules/@ramonda/core/dist/` beside whatever their bundler wrote, and `graph.json` there says
  neither whose it is nor what it is for. Same argument as the binaries being `ramonda-check` and
  `ramonda-check-bundle` rather than `check` and `check-bundle`. An app writing its own graph needs no
  prefix and does not get one: it picks the path, and nobody else ever reads the file.

  Collision was never a correctness risk and this does not fix one — a foreign `graph.json` in `dist`
  would have been refused out loud rather than believed, because the loader checks `schema`, `scope`,
  the package name and the declaration-file hash before anything is spliced. What it removes is the
  chance of two tools quietly overwriting each other in the one directory every tool treats as its
  own.

  Verified end to end rather than assumed: the four packages emit to the new path, `npm pack` carries
  `dist/ramonda-graph.json`, and `apps/playground-core` — the one project here that resolves a Ramonda
  package through `node_modules` rather than a tsconfig path — still splices `Form`, `Field`,
  `FormProvider` and `FormState` out of `@ramonda/form`'s fragment.

## 0.8.0

### Minor Changes

- b5a2ec5: Every package ships its graph, and a graph describes what a project ships.

  `@ramonda/core`, `@ramonda/router`, `@ramonda/query` and `@ramonda/form` emit their fragment in
  their own build and point at it from `package.json`:

  ```json
  { "ramonda": { "graph": "./dist/graph.json" } }
  ```

  An app that installs them rather than compiling them from source now gets their composition instead
  of a hole. Measured on `apps/playground-core`, which has no `paths` entry for `@ramonda/form`: its
  two unresolved `this.use(Form<typeof schema>)` edges are gone, and four of the package's own nodes —
  `Form`, `Field`, `FormState` and the context the form publishes — are in the app's graph.

  **A graph now describes what a project ships, so test files are left out** — `__tests__/`, `test/`,
  `tests/`, `*.test.*`, `*.spec.*`, judged relative to the directory holding the tsconfig. This is a
  change to what the checks read as well: a class written to be checked is no longer reported. It had
  to happen for a fragment to mean anything. Measured: `@ramonda/query` counted 109 components against
  a real 12, `@ramonda/form` came out as an APP because its tests mount one, and core's fragment
  carried a component from a fixture directory.

  Two more things fell out of emitting fragments for real packages:

  **A root is a `bootstrap` that names a component.** `@ramonda/testing-library` calls `bootstrap` on
  a vnode it is handed — that is its whole job — and a call whose argument nothing can name starts no
  tree. Counting it made every package that maps testing-library in its tsconfig come out as an app.

  **A library's fragment describes itself.** These packages compile their dependencies from source, so
  `@ramonda/router`'s fragment carried `@ramonda/core`'s classes too — the same nodes, under the same
  ids, that core's own fragment declares. An app splices one fragment per package and gets each once;
  an edge pointing into another package still resolves, because the id is the same on both sides.

  Across this repository's four apps the graph is now complete but for two edges, and both are
  deliberate demonstrations of a failed load.

## 0.7.2

### Patch Changes

- 7879405: `merge()` — structural sharing, and the one place an app can say which row is which.

  `list()` infers identity, and for the shapes real data takes it is right. But it is inference, and there was no way to tell it otherwise. `merge` is that way, and it sits at the data boundary rather than on the list — said once, where the rows arrive, instead of on every list that renders them.

  ```ts
  this.rows = merge(this.rows, await api.getRows()); // shares what did not change
  this.rows = merge(this.rows, await api.getRows(), (r) => r.id); // and pairs rows across a reorder or a resize
  ```

  With an identity, an unchanged row comes back as the same object wherever it moved to, and a changed row carries its predecessor's identity so it updates in place instead of being rebuilt. Without one, a refetch that changed nothing is not a change at all.

  `@ramonda/query` has done the structural-sharing half on every fetch for a while; it now uses this implementation, so an app gets the same function with the same bounds whether its data came through a query or not.

  **Also fixed:** a frozen row kept no identity. `Object.defineProperty` throws on a frozen object, so a refetch of frozen rows rebuilt every one of them — measured, changed or not. The write falls back to a WeakMap, so freezing your data no longer costs you row identity.

## 0.7.1

### Patch Changes

- 78c79ef: `@watchProp` takes several selectors and runs once when any of them changed

  ```tsx
  @watchProp((p) => p.page, (p) => p.term, (p) => p.sort)
  reload(next: [number, string, string], previous: [number, string, string]) { … }
  ```

  **"Run this when any of these props changed" was previously unwritable.** Stacking the decorator makes a
  separate entry per selector, so the method runs once per CHANGED prop — twice when two moved in the same
  update. And selecting a tuple from one selector is worse: comparison is `Object.is`, so a fresh array is
  never equal to the last one, and the method fires on **every** props change with `previous` and `next`
  holding identical contents. Both measured; both are now covered by tests.

  Comparison stays `Object.is` per selector, so nothing is compared deeply and the cost is unchanged. Only
  the CALL is coalesced. A selector whose value did not change keeps it in both arrays, so
  `previous[i] === next[i]` is how the method tells which one moved.

  **Breaking: the values are always a tuple, including for one selector.** `(next: string)` becomes
  `([next]: [string])` — destructuring in the parameter list leaves every method body untouched.

  That is about evolution rather than neatness. With a scalar for one selector and a tuple for several,
  adding a second selector to a watcher that already exists silently changes the method's parameter type,
  and what a decorator reports for that is `TS1241 Unable to resolve signature of method decorator`, which
  names nothing useful. A tuple that grows leaves `next[0]` meaning what it always meant.

  **Two of this package's own call sites were silently wrong after the change and the compiler accepted
  both**, which is worth knowing if you have your own: a parameter typed as a deferred conditional
  (`InferIn<S>` in `@ramonda/form`) or as anything array-shaped (`QueryKey` in `@ramonda/query`, which is
  `readonly unknown[]`, so a one-tuple is assignable to it) type-checks and then receives the tuple.
  `@ramonda/form`'s late-defaults suite caught it; the types did not. Audit by shape, not by `tsc`.

## 0.7.0

### Minor Changes

- f4e0b66: `RMQ001` and `RMQ002` are records, not just console lines

  Both diagnostics now reach [the collector every reporting package shares](https://ramonda.pages.dev/reference/diagnostics#capturing-them),
  so `@ramonda/devtools` shows them in its `LOGS` tab and `installDiagnostics` can take them anywhere
  else. A string carries a fault to a human and nowhere else: nothing could filter these by severity or
  group them by cause without parsing prose.

  What a reader sees changes in two small ways. The console line names the package —
  `[Ramonda query RMQ001] …` — and the advice is separated from what happened, printed under `→` and
  carried in the record's own `fix` field, so a panel can render it apart from the message.

  **Deduplication is unchanged and now published.** A key is hashed on every render, so an unstable one
  would report on every pass; one report per distinct cause is what that has always meant. The record
  carries the `dedupKey` this package deduplicates on — `RMQ001:function`, `RMQ002:<key>:<reason>` — so a
  collector collapses exactly what this package collapses rather than guessing.

  Nothing ships: the table of advice sits behind `__DEV__ ? … : {}` rather than being merely unreachable,
  because a bundler drops the function and keeps a table only that function read — measured at 2.2 KB in
  `@ramonda/lens`, which is where that lesson was paid for. The production suite still asserts that an
  unstable key is hashed silently.

## 0.6.0

### Minor Changes

- e06dd85: A devtools tab is its own entry, and a package only announces

  ```ts
  if (import.meta.env.DEV) {
    void import("@ramonda/devtools");
    void import("@ramonda/query/devtools");
    void import("@ramonda/form/devtools");
  }
  ```

  Each tab now lives behind `/devtools` on its package, and importing that entry registers it.
  `create-ramonda` writes these lines for the add-ons you pick.

  **Why it moved.** A package that imports the module describing its tab puts that description into
  the bundle of every application using the package — `__DEV__` strips it from production, but not
  from development. Measured: 12.4 KB of query and 5.2 KB of form were in the development bundle of
  every app, whether or not anyone ever opened the panel. Both are now only in the bundle of an app
  that asked for a tab.

  **How a package reaches its tab instead.** An event. `QueryClientProvider` and `Form` announce
  themselves arriving and leaving with one `__DEV__`-guarded line each, and the entry listens and
  keeps whatever list it needs. Nothing about a panel lives on the class — no field, no method, both
  of which ship whatever the guard says — and the package does not know whether anybody is listening.

  That is the shape core already uses for `ramonda:tick` and `ramonda:dev-log`.

  Nothing changes for an app beyond the import lines: both tabs look and behave as before.

### Patch Changes

- e623571: `@ramonda/check` finds class fields holding a function literal, and its bin is now `ramonda-check`

  Ramonda binds every method to its instance, so `onPick = (id) => this.select(id)` buys nothing over
  `onPick(id) { … }` and costs one closure per instance. The check reports each one, and says which of
  the two fixes applies: a body that reads `this` wants to be a method, a body that does not wants to
  leave the class.

  It reads the source because nothing else can. At runtime the two are indistinguishable — by the time
  anything could look, the framework has written a bound function onto the instance under every
  method's name, and a field holding `debounce(this.save, 200)` is a function there too. That one is
  legitimate: a wrapper cannot be written as a method. Only the source tells a function literal from a
  call that returns one. `static` fields are not reported either — one per class, so nothing to save.

  **The bin is renamed** from `ramonda-check-context` to `ramonda-check`, because it no longer checks
  only contexts. Update the `build` script: `ramonda-check && …`. `npm create ramonda` writes the new
  name.

  `@ramonda/query` had one of these itself — `Query.observe` was an arrow field and is now a method.

- e06dd85: Devtools registration no longer costs a production build

  Registering a panel used to leave a method and a field on the class, and neither can be tree-shaken:
  esbuild cannot prove a method is never reached dynamically, and a declared field is emitted on every
  instance. So every form in a production app carried ~500 bytes of dead code and a per-instance slot,
  and its `@destroyed` called a cleanup that could not exist.

  The description and the cleanup now live in the module that owns the panel — a free function and a
  `WeakMap` keyed by instance — leaving one `if (__DEV__)` line at each end of the class. `@ramonda/form`'s
  production bundle is 529 bytes smaller, and every devtools name is now absent from it.

  No behaviour changes; the panel works exactly as before.

- 4385dec: The QUERY and FORMS tabs find what was already there when the panel loads

  A devtools tab arrives through a dynamic import, so it loads after the app has mounted — and
  anything that announced itself during that mount announced to nobody. `QueryClientProvider`
  announces from `@created`, which runs during hydration, and its provider sits at the root and never
  mounts again: the QUERY tab was empty for the life of the page. `Form` had the same fault and only
  looked fine because a form usually mounts on a later route.

  Both now answer a request as well as announcing once, and both entries ask on load. The SSR
  playground's smoke test asserts the QUERY tab knows of a client, and fails with the reason if either
  half goes away.

## 0.5.0

### Minor Changes

- 4384f18: Devtools takes plugins, and Query and Forms are the first two

  **A package can register a tab.** `@ramonda/devtools` exports `panelRegistry()`, and anything that
  registers a description gets a tab built for it. The description is DATA, never markup: a row has a
  title, a status, typed fields, an optional value and its actions, and the panel decides what all of
  that looks like. That keeps the tool the app is diagnosed with out of the app's hands, keeps its
  look coherent, and keeps the contract small enough to version honestly. See
  [Adding a tab](https://ramonda.pages.dev/devtools/panels).

  ```ts
  const off = panelRegistry().register({
    version: 1,
    id: "sockets",
    label: "SOCKETS",
    snapshot: () => ({
      groups: [
        {
          rows: [
            {
              id: "ws-1",
              title: "wss://api.example.com",
              status: "ok",
              fields: [
                { kind: "live", id: "age", text: "last message 4s ago" },
              ],
              value: { data: lastFrame, revision: frameCount },
              actions: [{ id: "close", label: "close" }],
            },
          ],
        },
      ],
    }),
    run: (rowId, actionId) => undefined,
  });
  ```

  Register from an instance's lifecycle rather than at module import, so the list is exactly the live
  sources. A field marked `live` — a clock, a countdown — keeps its own text node while the rest of
  the list holds still, which is what stops a tab rewriting itself twice a second.

  **`@ramonda/form` has a Forms tab.** Every mounted form, whether it is valid, how many fields are
  blurred and edited, and a row per field that is actually wrong — with whether that field has been
  interacted with at all, which is the answer to "it says this is required and I have not touched it".
  `reset` and `submit` go through the form, so submit is the real one, validation and `onSubmit`
  included. The values are read-only: a form holds the schema's input side, and a `Date` does not
  survive being typed back as JSON.

  **`@ramonda/query` describes its own tab now.** The panel used to know what a query row looks like:
  which badge means fetching, that `observers: 0` is worth calling out, that a bounded copy must not
  be editable. That is knowledge about a cache, and it lives with the cache. `__RAMONDA_QUERY__` is
  gone — the registry replaced it — and with it the `QueryBridge` / `QueryRow` / `QuerySnapshot`
  types, which existed only to carry a cache to something that knew how to draw it.

  Nothing changes for an app: the Query tab looks and behaves as it did.

  **A removed panel kept calling into the app.** `disconnectedCallback` stopped neither poll timer, so
  a panel taken out of the document went on asking the cache for a snapshot and the profiler for its
  commits — measured at thirteen further calls over five seconds, and still going. Every tab is
  stopped on teardown now.

  `panelRegistry` and the contract's types are the package's first public exports — everything else
  in it is the panel's own implementation, imported for its side effect.

  **Internal: the panel splits into modules.** `index.ts` goes 2777 → 765 lines; what is left is the
  frame — docking, dragging, tabs, logs. The component tree, the value viewer, the profiler and the
  plugin renderer are their own files.

## 0.4.1

### Patch Changes

- 3fcff59: `INSPECT`: an instance can tell the devtools panel what it actually holds

  The inspector reads `@state`, `@persist`, props and context reads — all four about how a value was
  **declared**. A hook that keeps its state in plain fields behind a `@state` counter therefore showed
  the counter and nothing else. For `@ramonda/form` the whole panel row was `state: { version: 7 }`
  and props that never change: a number going up, and nothing anyone would open the panel to look at.

  That shape is what the framework recommends rather than an oversight. `@state` means "serialise me
  into the hydration blob", so a hook holding a `Date`, a `File` or a class instance keeps them in
  ordinary fields and bumps a counter to schedule the render. `Mutation` does the same with `lastData`.

  So the instance answers for itself:

  ```ts
  import { INSPECT } from "@ramonda/core";

  class Basket extends Hook {
    @state private version = 0;
    private lines: Line[] = [];

    [INSPECT]() {
      return { lines: this.lines, total: this.total };
    }
  }
  ```

  The panel shows it under **Holds**, using the value tree it already had — no new tab, no registry, no
  versioned panel API. `Mutation` implements it too.

  Three properties worth naming, because they are what keep this from becoming a plugin surface by
  accident:

  - **Per instance, found by the walk that already visits it.** `registerStore` was removed from the
    devtools bridge because it let a module-level singleton publish itself, advertising the global
    pattern this framework steers away from. This has the opposite property: an instance outside the
    tree cannot contribute, and one that unmounts stops contributing with nothing to deregister.
  - **Read-only.** This is what the instance _derived_; writing to a copy would change nothing while
    looking as though it had.
  - **A throwing `[INSPECT]()` costs its own row and nothing else.** It is code the framework did not
    write, called during a walk whose job is to diagnose an app that may already be broken.

  **It must be a pure read**, and that is a contract rather than a suggestion. The panel calls it on
  every commit while it is open on the components tab, so writing state from inside it closes a circle:
  the write schedules a render, the render commits, the commit pings the panel, and the panel asks
  again. Nothing catches that today — measured — and it turns only while somebody is looking, which is
  the worst time for an app to start moving under them.

  `Symbol.for`, not `Symbol()`, so two copies of core in one app still agree.

## 0.4.0

### Minor Changes

- 9af764d: **Removed `queryOptions`, `mutationOptions` and `infiniteQueryOptions`.** Name the types on
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

## 0.3.0

### Minor Changes

- 9a36ad4: Edit a query's cached data from the panel — the one edit you see on the page immediately.

  Asked for after editing a query hook's `version` and seeing nothing: that field is an invalidation
  counter, so the write landed and the page still rendered from the cache. The **cache** is the thing to
  edit, and now `✎` on a Query row does it.

  It goes through the same `setData` an optimistic update calls, so nothing about the write is special: a
  fetch in flight is abandoned (it is older information than the write), structural sharing keeps the
  identity of what did not change, `updatedAt` moves, status becomes `success`, and every observer is
  notified. A refetch replaces it, which the panel says as it writes.

  Two refusals, both deliberate:

  - **No pencil for a value that arrived truncated.** The bridge sends a bounded copy, and a bounded copy
    carries markers where values were dropped — writing one back would put `"[… budget]"` into the cache.
    The bridge reports whether the copy is the whole value, and the panel only offers an edit when it is.
  - **No pencil when the query package is older than the panel**, since it has no write side to call.

  The list also holds still while you are typing into it: a cache event anywhere rebuilds it twice a
  second, and without that the box would vanish mid-sentence.

### Patch Changes

- ae5101a: `RMQ001` is documented, and the diagnostics reference is grouped by package.

  Reported: `RMQ002` sat between `RMD023` and `RMD024`, so the list read as if it had been sorted and then
  broken. It was worse than that — **`RMQ001` was not in the reference at all**, while being raised in two
  places in `hashKey.ts`. A message that tells a reader to look up a code, pointing at a page that does not
  have it.

  The page now has a heading per package (`# Core — RMD`, `# Query — RMQ`) with the general "Reading them"
  section lifted above both, and the non-determinism inventory kept beside the RMD codes it explains.
  `RMQ001` has its own section: what a function or symbol in a key does (dropped by `JSON.stringify`, so
  two different keys hash identically and each query renders the other's data) and what a `Date`, `Map` or
  class instance does (serializes unstably, so the entry is never found again and every render refetches).

  And the docs build now fails when a diagnostic is raised in the source and missing from the reference —
  read from the source rather than from a list somebody maintains, with its own self-test to prove it can
  fail. That is the check that was missing when `RMQ001` slipped through.

- efed944: The documentation no longer teaches a decorator that does not exist.

  `@effect` was removed in 0.1.0, and the word stayed behind: the root README listed it among the
  decorators, core's README had a table row for it, `@ramonda/query`'s README explained mutation rollback
  by comparing it to "the cleanup contract `@effect` uses", and the sidebar group was called _Lifecycle and
  effects_. A reader following any of those looks for something that is not there.

  The `/concepts/subscriptions` page also stopped explaining itself as a migration. Its "There is no
  `@effect`" section was written for someone who had used the old decorator; it now answers the question a
  reader actually arrives with — _where did `useEffect` go_ — with a table from what you want to the name it
  has here, and keeps the reason: an effect is defined by its dependencies rather than its purpose, so one
  decorator would have to be all four of those things, and which one it was would depend on what its body
  happened to read that render.

  Elsewhere "effects" was the runtime's own vocabulary leaking into prose a reader cannot look up ("after
  this commit's `@mounted`s and effects"); those say _subscriptions_ now.

- 681b7e5: RMQ002's reporter no longer reaches the production build.

  Reported by Nikola, and true — `dist/index.prod.js` contained `reportIgnoredError(){}`. The body, the
  message and the string `RMQ002` were all stripped by `__DEV__`; the declaration was left standing,
  because **a class method cannot be tree-shaken** — nothing can prove it unused. It is a module function
  now, referenced only inside `if (__DEV__)`, which a bundler drops whole. That is how every other
  diagnostic in this repo is written, and now there is a reason written down for why.

  The worse half was its DEV-only `@mounted`. A lifecycle decorator registers from an initializer, so in
  production **every `Query` instance** allocated an id, bound the empty method, pushed an entry onto the
  runtime's mounts, and the flush then called it — per instance, for a method that did nothing. The
  restored-error case reports from the top of `load` instead, an `@mounted` that exists in every build, and
  it is unaffected by being earlier: a refetch moves `fetchStatus`, not `status`, so a restored failure is
  still there to see.

  Both names are in the production-build test's forbidden list now, and putting the method back fails it.

- 5940f4f: The status banner states the plan instead of apologising — and stops claiming `0.0.x`.

  Both READMEs said "Status: early … versions are `0.0.x`", which was false (core and query are past 0.2.0)
  and, worse, said nothing about what happens next. Someone reading it learns the API is unstable but not
  whether that is a phase or a temperament.

  It is a phase, and it now says so: `0.x` is exploration, where the API changes freely between releases and
  the packages are on npm to be installed and tried rather than adopted. **At `1.0` that flips** —
  interfaces hold, backward compatibility becomes a rule rather than a courtesy, and the work turns to
  performance and bugs. The whole point of the `0.x` months is to arrive at an API worth keeping still.

  Also corrected in `.github/workflows/README.md`, which still described the first publish in the future
  tense ("the packages are not on npm yet").

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
  unmounting — `@destroyed`, cleanups, local state, focus, scroll position — and a retry then has
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
  immediately. And it runs from `@updated` _and_ `@mounted`: an error restored from a server render
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
  several, so registration happens in the provider's `@created` (client only — a server render
  has no panel, and `@destroyed` never runs there) and is undone in `@destroyed`. A torn-down tree
  therefore takes its cache out of the list, so the panel cannot hold one alive or show one
  that no longer exists.

  Ten tests on the bridge, plus one in the production run asserting the global is never
  installed. Two of them are notes rather than checks: `remove` on a key something is still
  watching does not make the row vanish — the observer re-subscribes onto a fresh entry and
  fetches again, because `remove` notifies observers with `"removed"` exactly so they stop
  rendering something deleted — and a row whose entry was collected between being drawn and
  being clicked is looked up fresh, so an action on it does nothing instead of throwing.

  One finding recorded in the code: `@created` ignores what it returns. A teardown returned from
  it is silently dropped — that contract belongs to `@effect` and `createSubscriptionDecorator` —
  so the registry grew by one per test until the two halves were written out as `@created` plus
  `@destroyed`.

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
  child→parent while `@created` runs parent→child, so an effect handed a nested route's title
  back to its layout on the first commit. A `@watchProp` runs in the same order as `@created`
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
