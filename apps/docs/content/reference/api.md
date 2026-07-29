---
title: API
description: Every export in every package, with what it is for.
section: Reference
order: 111
---

# API

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
| `stable(value)` | Keeps an array or object in a hook's props at one identity while its contents are equal. [Writing a hook](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity) |
| `Head` | Per-page `<title>` and `<meta>`. [Head and metadata](/ssr/head) |
| `AsyncLoad` | Loads a module the first time it is rendered. [Lazy loading](/composition/lazy) |
| `ErrorBoundary` | Catches what a subtree throws while rendering. [Error boundaries](/composition/error-boundaries) |
| `createContext(default, options?)` | Returns `[Provider, Consumer]`. [Context](/composition/context) |

### Entry points

| | |
|---|---|
| `bootstrap(vnode, element)` | Mounts an app. |
| `unmount(element)` | Tears down everything `bootstrap` mounted, running `@destroy` throughout. Removing the element is **not** a substitute. |
| `h(tag, props, ...children)` | What JSX compiles to. Callable directly for a tag that is a value. [JSX](/concepts/jsx) |

### Server rendering

| | |
|---|---|
| `renderToString(vnode)` | An app → HTML, awaiting async lifecycle. [Details](/ssr/render) |
| `renderPage(vnode)` | The same, plus `{ title, head }`. [Head](/ssr/head) |
| `renderDocument(page, options?)` | Wraps a rendered page in a complete document. [Static builds](/ssr/static) |
| `hydrateRoot(vnode, element)` | Adopts the server's DOM instead of rebuilding it. |
| `ServerRedirect` | Thrown by `renderToString` when a render asks to redirect; catch it and answer with a 302. [Guards](/routing/server) |
| `captureServerRedirect()` | Low-level hook to record a server redirect for the current render. [Guards](/routing/server) |

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
| `@effect` | After the commit, and again when a signal it read changes. Return a cleanup. [Effects](/concepts/effects) |

`@create`, `@mount` and `@destroy` take `{ env: "client" | "server" | "shared" }`. [Which to use](/ssr/env)
`@updated` does not: a server render has no layout and no paint, so it is client-only.

### Decorators — reacting

| | |
|---|---|
| `@watchProp(selector)` | Runs when one prop changes, **before** the render. [Props](/concepts/props) |
| `@shouldUpdateOnPropsChange` | Gates whether new props from the parent are taken up (their signals update + a render). Components only; runs only on prop changes. |
| `@deferHydration` | Keeps the server's markup while a promise settles. [Async on the server](/ssr/async) |

### Decorators — the DOM

| | |
|---|---|
| `@Host(tag, props?)` | The element a component **is**. `tag` may be a callback of props. [The host element](/concepts/host) |
| `@onElement(type, options?)` | Listener on the component's host. [Events](/concepts/events) |
| `@onWindow(type, options?)` / `@onDocument(...)` | Listeners on `window` / `document`. Work on a Hook too. |
| `@interval(ms)` / `@timeout(ms)` | Timers cleared on unmount. [Timers](/concepts/timers) |

### Building your own

| | |
|---|---|
| `createSubscriptionDecorator(name, connect, validate?)` | Turns "subscribe, and unsubscribe on unmount" into a decorator. [Your own decorators](/hooks/own-decorators) |

### Development switches

| | |
|---|---|
| `configureDev({ strictRender })` | Turns off the double render behind [RMD020](/reference/diagnostics). A no-op in production. |

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
| `createRoutes(map)` | Compiles a route table once. Call it at module scope. |
| `routePaths(config, extra?)` | `{ paths, needsData }` for a static build. [Static builds](/ssr/static) |
| `matchRoute` · `matchParams` · `matchCompiled` | Matching, for tooling. |
| `parseUrl` · `parseUrlString` · `buildUrl` · `sanitizeHref` | URL helpers. |

Types: `RouteConfig` · `RouteParams` · `RoutePaths` · `RouterState` · `RouterNavigator` ·
`NavigateOptions` · `PartialNavigateOptions` · `SearchParamsUpdater` · `HashTagsUpdater` ·
`HashTag` · `StateUpdater` · `RouteOutletProps` · `LinkProps`

---

## `@ramonda/query`

Cached, deduplicated, race-free async state. [Async data](/query)

| | |
|---|---|
| `QueryClientProvider` | A **hook** on the app root; owns the cache and publishes it, adds no element. Takes `{ client?, defaults? }`. [Setup](/query) |
| `Query` | Reads one query. `status` · `data` · `error` · `isPending` · `isFetching` · `isSuccess` · `isError` · `failureCount` · `updatedAt` · `isRestored` · `result` · `refetch()`. [Queries](/query/queries) |
| `Mutation` | Writes. `mutate(vars)` · `mutateAsync(vars)` · `reset()` · `cancel()` · `isIdle` · `isPending` · `isSuccess` · `isError` · `data` · `error`. [Mutations](/query/mutations) |
| `QueryClientAccess` | A hook that hands you the client, for imperative work. [Reaching the cache](/query/queries) |
| `QueryClient` | The cache itself: `fetch` · `prefetch` · `setData` · `peek` · `getEntry` · `all` · `isStale` · `invalidate` · `cancel` · `remove` · `sweep` · `subscribe` · `dehydrate` · `hydrate` |
| `queryOptions(options)` | Types a query's options so its callbacks' parameters are inferred. [Typing](/query) |
| `mutationOptions(options)` | The same, for a mutation. |
| `ServerQueryError` | What a failure from a server render arrives as. A real `Error`. [On the server](/query/server) |
| `hashKey(key)` · `keyStartsWith(key, prefix)` | Key hashing and prefix matching, for tooling. |

Types: `QueryKey` · `QueryStatus` · `FetchStatus` · `FetchContext` · `QueryFetcher` ·
`QueryProps` · `QueryResult` · `QuerySnapshot` · `QueryEntry` · `QueryBehaviour` ·
`ObserverBehaviour` · `QueryDefaults` · `RefetchOnMount` · `RetryPolicy` ·
`RetryDelayPolicy` · `QueryEvent` · `QueryObserver` · `QueryClientOptions` ·
`QueryClientProviderProps` · `MutationProps` · `MutationContext` · `MutationStatus` ·
`Rollback` · `DehydratedQuery` · `DehydratedState` · `SerializedError`

---

## `@ramonda/lens`

Immutable updates by path. Zero dependencies, usable on its own. [Immutable updates](/lens)

| | |
|---|---|
| `focusOn(root)` | Starts a path into `root`. Nothing runs until a terminal operation does. |

**Walking** — [details](/lens/paths)

| | |
|---|---|
| `.get(key)` | Descends into a property. Creating an absent key is allowed at the end of a path. |
| `.at(index)` | Descends into one element. Negative counts from the end. |
| `.where(pred)` | Descends into **every** element the predicate accepts. Narrow explicitly: `where<T>(…)`. |

**Writing** — each returns the new root. [Details](/lens/updating)

| | |
|---|---|
| `.set(value)` | Replaces the focused value. An equal value copies nothing. |
| `.update(fn)` | Replaces it with `fn(current)`. |
| `.merge(partial)` | Copies the focused object and assigns over it. |
| `.remove()` | Drops the property or element from its container. |
| `.push(...items)` | Appends to the focused array. |
| `.insert(i, ...items)` | Inserts at a position. `i === length` appends. |
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
