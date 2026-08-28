---
title: API
description: Every export in every package, with what it is for.
section: Reference
order: 111
---

# API

**Casing tells you where a decorator goes.** `PascalCase` is a class decorator —
`@StableProps`. `camelCase` goes on a member — `@state`, `@compute`, `@mounted`,
`@watchProp`. Nothing else distinguishes them at a glance, and the two groups are used in
different places, so the convention carries its weight.

Everything every package exports. Each entry links to the page that explains it.

---

## `@ramonda/core`

### Classes

| | |
|---|---|
| `Component<P>` | The base class. Extend it and implement [`render()`](/concepts/components). |
| `Hook<O>` | State and lifecycle with [no element](/hooks). |
| `Ref<T>` / `createRef<T>()` | Holds a real DOM node. [Refs](/concepts/refs) |
| `SAME_ITEM` | The option for a lens `set` that replaces a list item with the same item rebuilt, so it keeps its element and its component. [Lens](/lens#editing-an-item-and-replacing-one) |
| `merge(previous, next, identity?)` | Keeps the previous value where the new one equals it, so a refetch is not a change. With `identity`, rows are paired across a reorder or a resize and a changed row keeps its identity. [Lists](/lists#refetched-data-and-objects-that-are-re-created) |
| `list<T>(each, render)` | Renders a list, minting identity from the items. `render` is a function taking one item. [Lists](/lists) |
| `@StableProps(...names)` | Declares which props are values, so a caller writes the plain literal. On a hook and on a component alike. [Writing a hook](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity) · [A prop that is a value](/concepts/props#a-prop-that-is-a-value) |
| `Head` | Per-page `<title>` and `<meta>`. [Head and metadata](/ssr/head) |
| `Timeout` / `Interval` | A scheduled call the app starts and the framework clears: `this.use(Timeout, () => ({ run }))`, then `start(ms)` and `stop()`. One instance is one timer; `start` returns whether it started, and teardown clears it. [Timers](/concepts/timers#a-timer-that-starts-when-you-say) |
| `Portal` | Renders a subtree into a DOM target elsewhere — e.g. `document.head`. [Portal](/composition/portal) |
| `portalTarget(name)` | Names a portal target outside the app's root, so it exists on the server too. `PORTAL_TARGET_ATTR` marks the container a shell emits. [Portal](/composition/portal) |
| `Select` | A `<select>`, whose value is which of its children is chosen. The plain tag is refused: `selected` on an option means whatever the render order made it mean. `<option>` is untouched. [Fields](/forms/fields#a-choice-lives-on-select) |
| `TextArea` | A `<textarea>`, whose value is the element's TEXT rather than an attribute. The plain tag is refused: nothing written as an attribute can carry the value, so a served page showed an empty field. [Fields](/forms/fields#a-textarea-keeps-its-value-inside-the-element) |
| `AsyncLoad` | Loads a module the first time it is rendered. [Lazy loading](/composition/lazy) |
| `ErrorBoundary` | Catches what a subtree throws while rendering. [Error boundaries](/composition/error-boundaries) |
| `createContext(default, options?)` | Returns `[Provider, Consumer]`. Options: `label` names the pair in devtools; `optional: true` says the default is a real answer, so a consumer with no provider above it is not reported. [Context](/composition/context) |

### Entry points

| | |
|---|---|
| `bootstrap(vnode, element)` | Mounts an app. |
| `unmount(element)` | Tears down everything `bootstrap` mounted, running `@destroyed` throughout. Removing the element is **not** a substitute. |
| `__h(tag, props, ...children)` | The vnode factory, for a tag that is a value or children you have to spread. Compiled JSX does **not** call it — that goes through the `@ramonda/core/jsx-runtime` import the compiler writes. [JSX](/concepts/jsx) |

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
| `requestContext()` | Per-request data — `url`, `cookies`, `headers`, `get(key)`. Read it **synchronously**: on the server the scope is cleared before the render's first `await` ([RMD053](/reference/diagnostics)). Per-request reads throw during a static build (that guards prerendering). |
| `requestKey<T>(label)` | Declares a typed per-request slot for `requestContext().get`. |
| `seedRequest(key, value)` | Server-only: fills a slot for the render already under way. Values known beforehand go to `renderToString` as `request.values`, keyed by the key itself. [Details](/ssr/request) |
| `RequestReadDuringBuild` | Thrown when per-request data is read during a static build — the route cannot be prerendered. |

`ServerRequestInit.values` takes pairs of KEY and value — an array literal is the natural spelling,
since `new Map([…])` cannot infer a heterogeneous one. A label is never written twice.

The types beside them: `RenderToStringOptions` and `ServerRequestInit` are what `renderToString` takes,
`StaticRender` is what `renderStatic` returns (`{ html }` or `{ blockedBy }`), and the per-request family
is `RequestContext` with `RequestCookies`, `RequestMode`, plus `RequestKey<T>` and `RequestKeyOptions`
for a declared slot.

### Decorators — state

| | |
|---|---|
| `@state` | Turns a field into a signal. [State](/concepts/state) |
| `@compute` | Caches a derived value; method or getter. [Derived values](/concepts/compute) |
| `@persist` | Marks a non-reactive field as part of the hydration payload. [env](/ssr/env) |
| `@memoized` | Caches a function by its arguments, per instance. |

### Decorators — lifecycle

| | |
|---|---|
| `@created(options?)` | Runs while building; no DOM yet. [Lifecycle](/concepts/lifecycle) |
| `@mounted(options?)` | Runs once the element is in the document. Returning a promise makes a server render wait. [Async on the server](/ssr/async) |
| `@updated` | Runs after every commit **after** the first, with the new DOM in place. No deps, no previous values, no cleanup. [Lifecycle](/concepts/lifecycle) |
| `@destroyed` | Runs on teardown, while state is still readable. |
| `createSubscriptionDecorator(name, connect)` | Your own subscription decorator: connect after the commit, and what it returns is the cleanup. [Subscriptions](/concepts/subscriptions) |

`@created`, `@mounted` and `@destroyed` take `{ env: "client" | "server" | "shared" }`, and `shared` is
the default. [Which to use](/ssr/env) — `@updated` has no `env`, because a server render commits
once and so never produces the update it reacts to.

That options bag is `LifecycleOptions`, and the side itself is `RenderEnv` — the argument a lifecycle
method receives, so a shared method can branch without a `typeof window` check, which is unreliable
anyway under a server DOM shim.

**Which decorator runs where, works on what, and may repeat:
[the decorator table](/reference/decorators).**

### Decorators — reacting

| | |
|---|---|
| `@watchProp(selector)` | Runs when one prop changes, **before** the render. [Props](/concepts/props) |
| `@ShouldUpdateOnPropsChange` | A CLASS decorator taking `(self, previous, next) => boolean`: gates whether new props from the parent are taken up (their signals update + a render). For ignoring a change that really happened — a prop merely rebuilt with equal contents is `@StableProps`' job. Components only. |
| `@deferHydration` | Keeps the server's markup while a promise settles. [Async on the server](/ssr/async) |
| `@catchError` | Declares the method that handles an error thrown anywhere below this component. Return `false` to decline it and let the next one above take over. Components only; one per class ([RMD032](/reference/diagnostics#rmd032-more-than-one-catcherror-on-a-component)). |

### Decorators — the DOM

| | |
|---|---|
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

All 32, grouped by what they belong to. The server and per-request ones are explained under
[Server rendering](#server-rendering); the rest are the shape of whatever they are named for.

**Markup** — `VNode` · `RamondaNode` · `ComponentChild` · `ComponentClassKind`

**Hooks and options** — `HookMeta` · `HeadOptions` · `MetaTag` · `LinkTag` · `PortalProps` · `PortalTarget` · `Each` · `ItemRender` · `ItemComponent` · `Identity` ·
`AsyncLoadProps` · `AsyncLoadFailure` · `Lazy` · `ContextOptions` · `ErrorBoundaryFallbackProps` · `SelectProps` · `TextAreaProps`

**Refs and subscriptions** — `RefCallback` · `RefTarget` · `SubscriptionOwner` · `Disconnect`

**Lifecycle** — `LifecycleOptions` · `RenderEnv`

**Server rendering** — `RenderedPage` · `DocumentOptions` · `RenderToStringOptions` ·
`ServerRequestInit` · `StaticRender` · `RequestContext` · `RequestCookies` · `RequestKey` ·
`RequestKeyOptions` · `RequestMode`

**Development** — `DevFlags`

`HookMeta` is the third argument to `this.use()` — what a `use()` says **about** a hook rather than
what it passes into one. One field today, `label`, which devtools adds to the hook's class name:
`Form (Sign Up)`. Development-only, and the hook never sees it. See
[naming a hook](/hooks#naming-one-for-devtools).

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
| `routePlan(server, paths?)` | Partitions the routes into `{ static, isr, server, needsData }` for the build. `static` holds paths, never patterns: a route with a `:param` marked `prerender` needs its concrete paths in `paths`, and throws without them. [Rendering modes](/ssr/modes#a-route-with-a-param-the-build-has-to-be-told-which-pages-exist) |
| `createIsrCache({ plan, store, render, maxPages?, onerror?, now? })` | The ISR cache. `serve(path)` gives `{ html, mode }` — fresh, stale-while-revalidate, or a cold render — and `undefined` for a path that is not an ISR route. A route with a `:param` caches each page separately and needs `maxPages`, which drops the page nobody has asked for longest. [Where ISR pages are kept](/ssr/modes#where-isr-pages-are-kept) |
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
| `Form` | A **hook** — `this.use(Form<typeof schema>, () => ({ schema, defaultValues, onSubmit }))`. Adds no element; the `<form>` stays your JSX. `fields` · `values` · `formErrors` · `isValid` · `isDirty` · `isSubmitting` · `submitCount` · `submit(event?)` · `reset(values?)` · `setError(path, message)`. [Your first form](/forms) |

`defaultValues` may move after the form exists — an untouched field takes the new value, an edited one
keeps what was typed. [Editing a record you had to fetch](/forms#editing-a-record-you-had-to-fetch)

Every field is reached by property access and its API sits behind `$`:
`f.address.street.$.value`. [Fields](/forms/fields)

| | |
|---|---|
| `FieldApi` | What every field has: `value` · `error` · `errors` · `touched` · `dirty` · `path` · `name` · `set(next)` · `reset()` · `at(key)`. |
| `LeafApi` | A field holding a single value. Adds `bind`. [Binding an input](/forms/fields) |
| `ArrayApi` | A field holding a list. Adds `length` · `rows` · `append(item)` · `insert(at, item)` · `remove(at)` · `move(from, to)`. [Array fields](/forms/arrays) |
| `Row` | One member of `rows`: `id` · `index` · `field`. The `id` is what keeps a row stable as it moves. |
| `Field` | A **hook**, for a component that watches ONE field — `this.use(Field<string>, () => ({ of: this.props.of }))`. Answers everything `FieldApi` and `LeafApi` do, plus the list members. **Required** for a field in its own component: a field node is one cached object for the form's life, so without this the component's props never change and it never re-renders. Also what makes an edit wake one field rather than the form. [A field in its own component](/forms/fields#a-field-in-its-own-component) |
| `FormState` | A **hook**, for a component that watches the FORM rather than a field — `this.use(FormState)`, no props. `isValid` · `isDirty` · `isSubmitting` · `submitCount` · `formErrors` · `submit(event?)` · `reset()`. Wakes only when a fact it reads actually MOVED, so a save button sleeps through typing that does not change the answer. The form publishes itself on the context, so it works at any depth. [A button that watches the form](/forms/fields#a-button-that-watches-the-form) |

Types: `FieldNode` · `FieldTarget` · `LeafNode` · `ObjectNode` · `ArrayNode` · `FormProps` · `ValidateOn` ·
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
| `.set(value, opts?)` | Replaces the focused value. An equal value copies nothing. Creates an absent key. `opts.keepSymbols` carries hidden symbols off the old value — `true`, or exactly the ones listed. |
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

Types: `Focus` · `FocusCommon` · `FocusArray` · `ElementOf` · `KeepSymbols`

---

## `@ramonda/build`

The three bundler settings an app needs, so the app names none of them. [Configuring your
build](/reference/build)

| | |
|---|---|
| `RAMONDA_TRANSFORM` | The three settings themselves — `jsx`, `jsxImportSource`, `target` — for a bundler with no adapter here. |
| `lowersDecorators(target)` | Whether a target compiles the decorators away. A list lowers if even one entry is something other than `esnext`. |
| `PUBLIC_ENV_PREFIX` | `"RAMONDA_PUBLIC_"` — the prefix that marks an environment variable safe to ship to the browser. |
| `publicEnv(env)` | The variables in `env` that may travel, and nothing else. |

### `@ramonda/build/vite`

| | |
|---|---|
| `ramonda()` | The Vite plugin. Fills in what the config left unsaid, and refuses what disagrees. |

### `@ramonda/build/esbuild`

| | |
|---|---|
| `ramondaOptions` | The settings, ready to spread into a build you call yourself. |
| `ramondaDefine(own?)` | The `define` entries that make `import.meta.env.RAMONDA_PUBLIC_*` work, merged with your own. Call it — a plain `define` after the spread would drop them. |
| `ramonda()` | The same settings as a plugin, for a build assembled somewhere you cannot reach. |

---

## `@ramonda/check`

The analyzer behind `ramonda-check`, as an import. [Checking your app](/reference/check)

| | |
|---|---|
| `analyzeProject(tsconfig)` | Reads a project and answers with everything below — the context issues, every rule's findings, and the graph they are computed from. |
| `ruleCatalogue()` | Every rule as four strings: its `id`, its severity, when it reports, and the runtime diagnostic that reports the same fault. The rule tables on the check page are built from this. |
| `splitOf(graph)` | What loads before anything, what each split point brings, and what they share. |
| `filesOf(declarations)` | How many files a set of declarations lives in. |
| `diffGraphs(before, after)` | What moved between two graphs — nodes, edges, and the size of the first payload. |
| `refuseToDiff(before, after)` | Why two graphs cannot be compared, or `undefined` when they can. |

`typescript` is a peer dependency: the analyzer uses **your** compiler, so it reads your syntax and
your config rather than guessing at them.

### The types

| | |
|---|---|
| `AnalyzeResult` | Everything one run found. |
| `Findings` | What each rule found, keyed by the rule's id and typed as that rule's own issue. |
| `RuleSummary` | One rule as `ruleCatalogue()` describes it. |
| `ContextIssue` | A consumer with no provider above it — the check this package was written for. |
| `ComponentGraph`, `GraphNode`, `GraphEdge`, `Where` | What can mount what, and where each fact was written. |
| `Split`, `SplitPoint` | What `splitOf` answers. |
| `GraphDiff` | What `diffGraphs` answers. |

[issues:start]: #

*Generated by `scripts/build-rule-tables.mjs` from what the package exports — edit the rule, not this.*

Every rule publishes its own issue shape, named for the rule: `AccessKeyIssue`,
`AriaHiddenAroundSomethingFocusableIssue`, `AriaHiddenOnFocusableIssue`,
`AriaStateTheRoleDoesNotHaveIssue`, `AriaStateWithNoRoleIssue`, `AriaThatContradictsTheTagIssue`,
`AriaValueIssue`, `AriaWithNoSubjectIssue`, `ArrowFieldIssue`, `AsyncRenderIssue`,
`AttributeThatDoesNothingIssue`, `AutocompleteThatFillsNothingIssue`, `BrowserUrlIssue`,
`CachedReadOfAPlainFieldIssue`, `ClassInsteadOfClassNameIssue`, `ClickWithNoKeyboardPathIssue`,
`ClientOnlyRequestReadIssue`, `ClockReadWhileRenderingIssue`, `ComputeTakesNoArgumentsIssue`,
`ContextConsumedAboveItsProviderIssue`, `ControlWithNoLabelIssue`, `DecoratorThatAddsNothingIssue`,
`DevGuardAsAnExpressionIssue`, `DomWriteIssue`, `DuplicateDecoratorIssue`, `DuplicateIdIssue`,
`DuplicateKeyAmongSiblingsIssue`, `EmptyHeadingOrLinkIssue`, `FalseOnABooleanAttributeIssue`,
`FragmentLinkToNowhereIssue`, `FreshObjectInHookPropsIssue`, `FreshObjectInPropsIssue`,
`FreshValueFromAWatchSelectorIssue`, `HeadTagsCollideIssue`, `HeadingSkipsALevelIssue`,
`IndexAsKeyIssue`, `InteractiveInsideInteractiveIssue`, `IntervalWithNoCleanupIssue`,
`LabelThatNamesNothingIssue`, `LandmarksThatCannotBeToldApartIssue`, `LateRequestReadIssue`,
`LinkWithoutADestinationIssue`, `ListenerAddedByHandIssue`, `LiveRegionThatContradictsItsRoleIssue`,
`MediaWithNoCaptionsIssue`, `MisspelledElementPropertyIssue`, `MoreThanOneMainIssue`,
`NamedOnlyByAPlaceholderIssue`, `OneProviderPerComponentIssue`, `ParentWithAForeignChildIssue`,
`PersistOfALossyValueIssue`, `PositiveTabIndexIssue`, `PresentationRoleOnFocusableIssue`,
`ReferenceToAnIdThatIsNotThereIssue`, `RegionWithNoNameIssue`, `RoleMissingRequiredAriaIssue`,
`RoleTakesNoNameIssue`, `RoleThatFightsTheTagIssue`, `RowReadsAPlainFieldIssue`,
`RowWithoutAKeyIssue`, `ServerEnvInSharedCodeIssue`, `StateMutatedInPlaceIssue`,
`StateWrittenWhileRenderingIssue`, `TableWithNoHeadersIssue`, `TagNeedsItsParentIssue`,
`UnexposedEnvReadIssue`, `UnguardedAsyncLifecycleIssue`, `UnkeyableMemoizedArgumentIssue`,
`UnknownAriaAttributeIssue`, `UnknownRoleIssue`, `UnnamedFrameIssue`, `UnnamedImageIssue`,
`UnserializableStateIssue`, `UnsplittableImportIssue`, `UnwatchedFieldIssue`,
`WatchOfAPropThatIsNotThereIssue`.

[issues:end]: #

The rules themselves are **not** exported, and that is a decision. A rule carries functions over its
own issue type and a `read` that takes a compiler node, so publishing one would make this package's
internals somebody's dependency and every change to a rule's shape a breaking change.
`ruleCatalogue()` is what a caller actually wants from them.

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
