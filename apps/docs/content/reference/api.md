---
title: API
description: Every export in every package, with what it is for.
section: Reference
order: 111
---

# API

**Casing tells you where a decorator goes.** `PascalCase` is a class decorator —
`@Host`, `@StableProps`. `camelCase` goes on a member — `@state`, `@compute`, `@mount`,
`@watchProp`. Nothing else distinguishes them at a glance, and the two groups are used in
different places, so the convention carries its weight.

Everything the three packages export. Each entry links to the page that explains it.

---

## `@ramonda/core`

### Classes

| | |
|---|---|
| `Component<P>` | The base class. Extend it and implement [`render()`](/concepts/components). |
| `Hook<O>` | State and lifecycle with [no element](/hooks). |
| `Ref<T>` / `createRef<T>()` | Holds a real DOM node. [Refs](/concepts/refs) |
| `list<T>(options)` | Renders a list, minting identity from the items. [Lists](/lists) |
| `@StableProps(...names)` | Declares which of a hook's props are values, so a caller writes the plain literal. [Writing a hook](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity) |
| `Head` | Per-page `<title>` and `<meta>`. [Head and metadata](/ssr/head) |
| `AsyncLoad` | Loads a module the first time it is rendered. [Lazy loading](/composition/lazy) |
| `ErrorBoundary` | Catches what a subtree throws while rendering. [Error boundaries](/composition/error-boundaries) |
| `createContext(default, options?)` | Returns `[Provider, Consumer]`. Options: `label` names the pair in devtools; `optional: true` says the default is a real answer, so a consumer with no provider above it is not reported. [Context](/composition/context) |

### Entry points

| | |
|---|---|
| `bootstrap(vnode, element)` | Mounts an app. |
| `unmount(element)` | Tears down everything `bootstrap` mounted, running `@destroy` throughout. Removing the element is **not** a substitute. |
| `h(tag, props, ...children)` | What JSX compiles to. Callable directly for a tag that is a value. [JSX](/concepts/jsx) |

### Server rendering

| | |
|---|---|
| `renderToString(vnode, opts?)` | An app → HTML, awaiting async lifecycle. `opts.request` makes it a per-request render so `requestContext()` returns real values. [Details](/ssr/render) |
| `renderPage(vnode)` | The same, plus `{ title, head }`. [Head](/ssr/head) |
| `renderStatic(vnode, url)` | A build-time render with the request context poisoned — returns `{ html }` to bake or `{ blockedBy }` if the route read per-request data. |
| `renderDocument(page, options?)` | Wraps a rendered page in a complete document. [Static builds](/ssr/static) |
| `hydrateRoot(vnode, element)` | Adopts the server's DOM instead of rebuilding it. |
| `ServerRedirect` | Thrown by `renderToString` when a render asks to redirect; catch it and answer with a 302. [Guards](/routing/server) |
| `captureServerRedirect()` | Low-level hook to record a server redirect for the current render. [Guards](/routing/server) |
| `requestContext()` | Per-request data — `url`, `cookies`, `headers`, `get(key)`. Per-request reads throw during a static build (that guards prerendering). |
| `requestKey<T>(label)` | Declares a typed per-request slot for `requestContext().get`. |
| `seedRequest(key, value)` | Server-only: fills a per-request slot before the render. |
| `RequestReadDuringBuild` | Thrown when per-request data is read during a static build — the route cannot be prerendered. |

### Decorators — state

| | |
|---|---|
| `@state` | Turns a field into a signal. [State](/concepts/state) |
| `@compute` | Caches a derived value; method or getter. [Derived values](/concepts/compute) |
| `@persist` | Marks a non-reactive field as part of the hydration payload. [env](/ssr/env) |
| `@memoizedHandler` | Caches a function by its arguments, per instance. |

### Decorators — lifecycle

| | |
|---|---|
| `@create(options?)` | Runs while building; no DOM yet. [Lifecycle](/concepts/lifecycle) |
| `@mount(options?)` | Runs once the element is in the document. Returning a promise makes a server render wait. [Async on the server](/ssr/async) |
| `@updated` | Runs after every commit **after** the first, with the new DOM in place. No deps, no previous values, no cleanup. [Lifecycle](/concepts/lifecycle) |
| `@destroy` | Runs on teardown, while state is still readable. |
| `createSubscriptionDecorator(name, connect)` | Your own subscription decorator: connect after the commit, and what it returns is the cleanup. [Subscriptions](/concepts/subscriptions) |

`@create`, `@mount` and `@destroy` take `{ env: "client" | "server" | "shared" }`, and `shared` is
the default. [Which to use](/ssr/env) — `@updated` has no `env`, because a server render commits
once and so never produces the update it reacts to.

**Which decorator runs where, works on what, and may repeat:
[the decorator table](/reference/decorators).**

### Decorators — reacting

| | |
|---|---|
| `@watchProp(selector)` | Runs when one prop changes, **before** the render. [Props](/concepts/props) |
| `@shouldUpdateOnPropsChange` | Gates whether new props from the parent are taken up (their signals update + a render). Components only; runs only on prop changes. |
| `@deferHydration` | Keeps the server's markup while a promise settles. [Async on the server](/ssr/async) |

### Decorators — the DOM

| | |
|---|---|
| `@Host(tag, props?)` | The element a component **is**. `tag` may be a callback of props. Components only, once per class. [The host element](/concepts/host) |
| `@onElement(type, options?)` | Listener on the component's host. Components only — a hook has no element. [Events](/concepts/events) |
| `@onWindow(type, options?)` / `@onDocument(...)` | Listeners on `window` / `document`. Work on a Hook too. |
| `@interval(ms)` / `@timeout(ms)` | Timers cleared on unmount. Client only; work on a Hook. [Timers](/concepts/timers) |

### Building your own

| | |
|---|---|
| `createSubscriptionDecorator(name, connect, validate?)` | Turns "subscribe, and unsubscribe on unmount" into a decorator. [Your own decorators](/hooks/own-decorators) |

### Development switches

| | |
|---|---|
| `configureDev({ strictRender })` | Turns off the double render behind [RMD020](/reference/diagnostics). A no-op in production. |
| `INSPECT` | A symbol. Define `[INSPECT]()` on a component or hook and the devtools panel shows what it returns, under **Holds**. [Devtools](/devtools#what-an-instance-holds) |

### Types

`VNode` · `RamondaNode` · `ComponentChild` · `ComponentClassKind` · `RenderedPage` ·
`DocumentOptions` · `HeadOptions` · `MetaTag` · `LinkTag` · `ListOptions` · `AsyncLoadProps` ·
`AsyncLoadFailure` · `Lazy` · `RefCallback` · `RefTarget` · `ContextOptions` ·
`SubscriptionOwner` · `Disconnect` · `DevFlags` · `ErrorBoundaryFallbackProps`

---

## `@ramonda/router`

| | |
|---|---|
| `Router` | A **hook** on the app root; owns the store, adds no element. Also exposes the `Navigator` surface (minus `params()`). [Setup](/routing) |
| `RouteOutlet` | Renders the matched route. |
| `Navigator` | `pathname` · `params<T>()` · `searchParams` · `hashTags` · `push` · `replace` · `updateSearchParams` · `updateHashTags` · `back` · `forward`. [Reading the URL](/routing/params) |
| `Link` | A real `<a href>` that intercepts a plain left click. [Links](/routing/links) |
| `createRoutes(map)` | Compiles a route table once, capturing its paths in the type. Call it at module scope. |
| `createRouter(routes)` | Returns `{ Router, RouteOutlet, Navigator, Link, route }` bound to the table, so `<Link href>` is type-checked. [Setup](/routing) |
| `route(pattern, params)` | Builds a `:param` href — the only way to make one; params are typed. [Links](/routing/links) |
| `routePaths(config, extra?)` | `{ paths, needsData }` for a static build. [Static builds](/ssr/static) |
| `matchRoute` · `matchParams` · `matchCompiled` | Matching, for tooling. |
| `parseUrl` · `parseUrlString` · `buildUrl` · `sanitizeHref` | URL helpers. |

Types: `RouteConfig` · `PathOf` · `Href` · `TypedRouterKit` · `TypedLinkProps` · `TypedNavigator` ·
`RouteParams` · `RoutePaths` · `RouterState` · `RouterNavigator` · `NavigateOptions` ·
`PartialNavigateOptions` · `SearchParamsUpdater` · `HashTagsUpdater` · `HashTag` · `StateUpdater` ·
`RouteOutletProps` · `LinkProps`

### `@ramonda/router/server`

Server-only — never imported from client code. See [rendering modes](/ssr/modes).

| | |
|---|---|
| `defineServer(routes, config, opts?)` | Per-route render modes, keyed exhaustively by path. `config` — `{ prerender?, revalidate? }` per route; `opts.defaultMode`. |
| `routePlan(server)` | Partitions the routes into `{ static, isr, server, needsData }` for the build. |
| `createIsrCache({ plan, store, render, onError?, now? })` | The ISR cache. `serve(path)` gives `{ html, mode }` — fresh, stale-while-revalidate, or a cold render — and `undefined` for a path that is not an ISR route. [Where ISR pages are kept](/ssr/modes#where-isr-pages-are-kept) |
| `memoryStore()` | Keeps baked pages in this process. One instance, or development. |
| `fileStore({ dir })` | Keeps baked pages in a directory: survives a restart, shared by instances that mount it. Writes atomically. |

Types: `ServerRoute` · `ServerConfig` · `ServerOptions` · `ServerRoutes` · `RoutePlan` ·
`IsrCache` · `IsrCacheOptions` · `IsrStore` · `IsrEntry` · `IsrPage` · `IsrMode` · `FileStoreOptions`

---

## `@ramonda/query`

Cached, deduplicated, race-free async state. [Async data](/query)

| | |
|---|---|
| `QueryClientProvider` | A **hook** on the app root; owns the cache and publishes it, adds no element. Takes `{ client?, defaults? }`. [Setup](/query) |
| `Query` | Reads one query. Write `Query<TData>` to type its callbacks — see [typing](/query#typing-the-callbacks). `status` · `data` · `error` · `isPending` · `isFetching` · `isSuccess` · `isError` · `failureCount` · `updatedAt` · `isRestored` · `result` · `refetch()`. [Queries](/query/queries) |
| `InfiniteQuery` | Reads one paginated query, pages under one key. `pages` · `pageParams` · `fetchNextPage()` · `fetchPreviousPage()` · `hasNextPage` · `hasPreviousPage` · `isFetchingNextPage` · `isFetchingPreviousPage` · `maxPages`, plus everything `Query` has. [Infinite queries](/query/infinite) |
| `Mutation` | Writes. `mutate(vars)` · `mutateAsync(vars)` · `reset()` · `cancel()` · `isIdle` · `isPending` · `isSuccess` · `isError` · `data` · `error`. [Mutations](/query/mutations) |
| `QueryClientAccess` | A hook that hands you the client, for imperative work. [Reaching the cache](/query/queries) |
| `QueryClient` | The cache itself: `fetch` · `prefetch` · `setData` · `peek` · `getEntry` · `all` · `isStale` · `invalidate` · `cancel` · `remove` · `sweep` · `subscribe` · `dehydrate` · `hydrate` |
| `ServerQueryError` | What a failure from a server render arrives as. A real `Error`. [On the server](/query/server) |
| `hashKey(key)` · `keyStartsWith(key, prefix)` | Key hashing and prefix matching, for tooling. |

Types: `QueryKey` · `QueryStatus` · `FetchStatus` · `FetchContext` · `QueryFetcher` ·
`QueryProps` · `QueryResult` · `QuerySnapshot` · `QueryEntry` · `QueryBehaviour` ·
`ObserverBehaviour` · `QueryDefaults` · `RefetchOnMount` · `RetryPolicy` ·
`RetryDelayPolicy` · `QueryEvent` · `QueryObserver` · `QueryClientOptions` ·
`QueryClientProviderProps` · `MutationProps` · `MutationContext` · `MutationStatus` ·
`InfiniteQueryProps` · `InfiniteData` · `PageContext` ·
`Rollback` · `DehydratedQuery` · `DehydratedState` · `SerializedError`

---

## `@ramonda/form`

Typed field paths, Standard Schema validation, and array rows that keep their identity.
[Forms](/forms)

| | |
|---|---|
| `Form` | A **hook** — `this.use(Form<typeof schema>, { schema, defaultValues, onSubmit })`. Adds no element; the `<form>` stays your JSX. `fields` · `values` · `formErrors` · `isValid` · `isDirty` · `isSubmitting` · `submitCount` · `submit(event?)` · `reset(values?)` · `setError(path, message)`. [Your first form](/forms) |

`defaultValues` may move after the form exists — an untouched field takes the new value, an edited one
keeps what was typed. [Editing a record you had to fetch](/forms#editing-a-record-you-had-to-fetch)

Every field is reached by property access and its API sits behind `$`:
`f.address.street.$.value`. [Fields](/forms/fields)

| | |
|---|---|
| `FieldApi` | What every field has: `value` · `error` · `errors` · `touched` · `dirty` · `path` · `name` · `set(next)` · `reset()` · `at(key)`. |
| `LeafApi` | A field holding a single value. Adds `bind`. [Binding an input](/forms/fields) |
| `ArrayApi` | A field holding a list. Adds `length` · `rows` · `append(item)` · `insert(at, item)` · `remove(at)` · `move(from, to)`. [Array fields](/forms/arrays) |
| `Row` | One member of `rows`: `id` · `index` · `field`. The `id` is what `list({ key })` uses. |

Types: `FieldNode` · `LeafNode` · `ObjectNode` · `ArrayNode` · `FormProps` · `ValidateOn` ·
`Bind` · `CommonBind` · `TextBind` · `NumberBind` · `CheckboxBind` · `DateBind` · `Collision` ·
`InferIn` · `InferOut` · `StandardSchemaV1` · `StandardResult` · `StandardIssue`

`StandardSchemaV1` is the [Standard Schema](https://standardschema.dev) interface, vendored so
the package depends on no validator. Anything implementing it works unchanged — bguard, zod,
valibot, arktype. [Validation](/forms/validation)

---

## `@ramonda/form/bguard`

What Standard Schema cannot express. bguard is an optional peer dependency, and the main entry never
reaches this module. [The bguard submodule](/forms/bguard)

| | |
|---|---|
| `htmlConstraints(schema)` | Returns a lookup by field path giving `required` · `minlength` · `maxlength` · `pattern` · `min` · `max` · `type`, derived from the schema. Answers are cached, so the same path is the same object every render. [HTML attributes](/forms/bguard#html-attributes-from-the-schema) |
| `unknownRefPaths(schema, values)` | Every `ctx.ref` path that names no field — the typo that otherwise passes silently for ever. Belongs in a test. [Cross-field rules](/forms/bguard#cross-field-rules-that-point-at-nothing) |

Types: `HtmlConstraints` · `UnknownRef`

---

## `@ramonda/lens`

Immutable updates by path. Zero dependencies, usable on its own. [Immutable updates](/lens)

| | |
|---|---|
| `focusOn(root)` | Starts a path into `root`. Nothing runs until a terminal operation does. |

**Walking** — [details](/lens/paths)

| | |
|---|---|
| `.get(key)` | Descends into a property. `__proto__`, `constructor` and `prototype` are refused. |
| `.at(index)` | Descends into one element. Negative counts from the end. |
| `.where(pred)` | Descends into **every** element the predicate accepts. Narrow explicitly: `where<T>(…)`. |

**Writing** — each returns the new root. [Details](/lens/updating)

| | |
|---|---|
| `.set(value)` | Replaces the focused value. An equal value copies nothing. Creates an absent key. |
| `.update(fn)` | Replaces it with `fn(current)`. |
| `.merge(partial)` | Copies the focused object and assigns over it. Does not create a missing object. |
| `.remove()` | Drops the property or element from its container. |
| `.push(...items)` | Appends to the focused array. A missing or `null` array counts as an empty one. |
| `.insert(i, ...items)` | Inserts at a position. `i === length` appends; negative counts from the end. |
| `.and(...branches)` | Forks the path: several edits, one walk of the shared prefix. |

**Reading**

| | |
|---|---|
| `.value()` | The first focused value, or `undefined`. |
| `.values()` | Every focused value. |

Types: `Focus` · `FocusCommon` · `FocusArray` · `ElementOf`

---

## `@ramonda/testing-library`

| | |
|---|---|
| `render(ui, options?)` | Mounts and returns the DOM plus bound queries. [Rendering](/testing/rendering) |
| `renderHook(hook, options?)` | Mounts a hook on a throwaway host. [Testing hooks](/testing/hooks) |
| `act(callback?)` | Commits everything the callback caused. [act](/testing/act) |
| `fireEvent` | The DOM library's, wrapped so the render is committed. |
| `cleanup()` | Unmounts everything. Registered automatically. |

Everything from `@testing-library/dom` is re-exported — `screen`, `waitFor`, `within`,
`prettyDOM`, every query.

---

## `@ramonda/core/testing`

A separate entry point, for building a test harness rather than for apps.

| | |
|---|---|
| `flushSync()` | Runs every pending update and mount now. |
| `rerenderRoot(vnode, container)` | Diffs new JSX into an already-rendered container. |
| `getComponentInstance(node)` | The component a DOM node belongs to. |

It exists so the main entry does not have to be widened for a test utility: a separate,
narrow door that a harness reaches for and an app never sees.
