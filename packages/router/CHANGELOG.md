# @ramonda/router

## 0.10.0

### Minor Changes

- 93428c5: `routePlan`'s `static` holds paths, never patterns — and a `:param` route marked for prerender now
  stops the build unless it is given them.

  `/guide/state` is one page; `/guide/:slug` is one route and however many guides there are. The pattern
  went into `plan.static` as itself, and a build loop bakes what it is handed — so it wrote
  **`dist/static/guide/:slug/index.html`**, a directory literally named `:slug`, a page no request can
  reach, and nothing said a word. The sibling in `match.ts` had this right from the start: `routePaths`
  puts a parameterised route in `needsData` and keeps it out of `paths`.

  ```ts
  const plan = routePlan(
    server,
    GUIDES.map((slug) => `/guide/${slug}`)
  );
  // plan.static    → ["/", "/guide/state", "/guide/effects", "/signup"]
  // plan.needsData → ["/guide/:slug"]
  ```

  With none supplied it **throws**, naming the route and spelling the call with the route's own param
  name. It stops rather than skipping the route or falling it back to the server, for the same reason
  `renderStatic`'s `blockedBy` stops it: a config that says `prerender` and a build that quietly does not
  is how a site ships missing half its pages while every page it emitted looks perfectly correct.

  ISR is not held to it. A `revalidate` route with a `:param` is served and refreshed per request, so its
  pattern is a rule rather than a page and there is nothing for a build to bake; it stays named in
  `needsData` for a build that wants to warm those pages.

  **Every path given has to be baked**, which the first version of this left open: `filled` only refused
  a route that matched NOTHING, so one good path silenced it and the rest were dropped without a word —
  measured, `["/guide/ok", "/guide/v1.2"]` came back as `["/guide/ok"]`. A `:param` matches one segment of
  `[\w-]+`, so a trailing slash, a dot, a percent-encoded character or a typo'd prefix all fall outside
  it, and dropping them silently is the very failure this throw exists to prevent. Found by review.

  The two faults also have two messages now. "Pass them" is for a call with no paths; a call whose paths
  do not match says so and names them, instead of sending a reader to add an argument that is already
  there.

  **And one thing this does NOT fix, now stated rather than claimed:** `revalidate` on a route with a
  `:param` is accepted and does nothing. `plan.isr` carries the PATTERN, `createIsrCache` keys its window
  map by that string and looks it up exactly, so `serve("/u/7")` finds nothing under `/u/:id` and the page
  renders per request with the real request context — no shared cache, the opposite of what `revalidate`
  asks for. An earlier version of this branch's own comment claimed such a route "is served and refreshed
  per request" and that a build could "warm those pages"; neither is true. The docs now tell a reader not
  to use it yet, and making it work or refusing it is a decision about a published API rather than a fix.

  `paths` is optional, so a table with no parameterised static route calls this exactly as before.

  **Dogfooded rather than argued.** `playground-ssr` gained `/guide/:slug` as a bakeable parameterised
  route beside the per-request `/users/:id` — same shape, opposite mode, which is the point: whether one
  is baked is the app's declaration. The real build writes both guides to real files, the smoke test
  asserts one is served from a file with its content in it, and removing the supplied paths stops the
  build with the message above.

- be4a2b9: An ISR route can take a `:param`, and the cache it fills is bounded.

  `revalidate` on `/products/:id` was accepted and did nothing. `plan.isr` carried the PATTERN, and
  `createIsrCache` keyed its window map by that string and looked it up exactly — so `serve("/products/7")`
  found no window, returned `undefined`, and the caller fell through to its dynamic branch. The page then
  rendered per request with the REAL request context: no shared cache, which is the opposite of what
  `revalidate` asks for, and nothing said so. Measured before the fix.

  `serve` matches the pattern now, and each page is cached under its own path. A LITERAL route is asked
  first, so `/products/new` beside `/products/:id` is the page somebody wrote rather than an id called
  "new".

  **And one route is now as many pages as there are items, so it needs a limit.** `maxPages` is
  **required** when any ISR route takes a `:param`, and refused when none does — a number that bounds
  nothing is a number somebody will trust. Without it, one crawler walking `/products/1`…`/products/100000`
  fills the store with pages nobody asked for.

  **The eviction is least RECENTLY asked for, not fewest hits**, and the intuitive rule is the wrong one:
  counts accumulate, so a product that was popular last week keeps its ten thousand while one that went
  viral an hour ago has three — and a brand new entry always has the fewest, so it would always be the
  first thrown out. Fixing that needs decaying counters, which needs a clock, which needs a test that
  depends on one. Recency adapts by itself and is a `delete`-then-`set` on a hit plus one `keys().next()`
  on an eviction, because a `Map` iterates in insertion order.

  The TTL is why the policy matters less than the cap: every entry dies after `revalidate` seconds anyway,
  so this never chooses between a fresh page and an ancient one — the bound is protection from BREADTH in
  a single window.

  **`IsrStore` gains `delete`**, because eviction cannot be expressed without it. A custom store must add
  one method; `memoryStore` and `fileStore` have it, and `fileStore` treats a missing file as success — an
  eviction that cannot happen must not turn a served page into a 500, and the entry expires on its own.

  Two prose claims that had gone false are corrected with it: `memoryStore` said it "cannot grow on its
  own" (true only while a route meant one page), and two server templates said `IsrStore` is two methods.

  **The cap is only as good as the count behind it, and that count is a map this process keeps beside a
  store it does not own.** Everything below is one of the two being made to agree with the other, and
  every case was measured.

  - Recency is recorded only for a page the store holds NOW. Recorded on the way in instead, a cold
    render that rejected left a key with nothing behind it and the cap counted the phantom: with
    `maxPages: 2`, one failed render made the next success drop BOTH live pages.
  - The trim runs after every answer, not only after a bake. Only-after-a-bake leaves a store this
    process did not fill unbounded — a `fileStore` directory after a restart: five seeded entries,
    `maxPages: 2`, five hits, nothing dropped.
  - A bake records its page beside the WRITE. The stale path trims before starting a rebake, so an entry
    evicted mid-rebake is written back into the store, and the count has to learn about it there or
    nothing can ever reach it again.
  - An eviction never fails an answer, and never leaves an orphan either. The store is dropped BEFORE the
    key is forgotten, `onError` hears about a `delete` that rejects, and the page is still served — a
    cache one entry too large is a page the visitor gets, a 500 is not. A failed delete also moves its key
    to the back and ends the pass: left oldest, it is what every later trim picks and fails on, and a
    single un-deletable key let a store grow to thirty entries under a cap of two.

  **A `store.delete` is a round trip, and the cache holds the keys inside one.** That set answers all
  three questions the wait raises. A key in it is not COUNTED, because a page whose deletion is committed
  is not a page the cache holds — counting it makes a concurrent trim evict one live page too many, and
  under `maxPages: 1` left the cache holding zero. A key in it is not PICKED, so a pass evicts the page it
  meant to. And a write REMOVES its key from it, which is how the reply can tell what happened while it
  travelled: a key still in the set saw only reads, so the entry is gone and the key goes with it; a key
  already out of it was rebuilt, and keeping it is what stops that new entry being orphaned.

  One thing a store of three unconditional methods cannot promise: a `delete` already travelling cannot
  be called off, so a rebake that lands inside its own eviction is removed by it. It needs a page to go
  stale in the same moment it is being evicted, and it costs that page plus one later render — never a
  wrong page, and the key that is left pointing at nothing is dropped by the next trim. Pinned by a test,
  because the regression to fear is a phantom that does NOT heal.

  Planted nine ways, and eight of the plants fail a test. The ninth — evicting a key another pass is
  already deleting — costs a duplicate `delete` and a moment over the cap, and changes which pages
  survive not at all; it says so where it is written.

  `onError` receives eviction failures as well as rebakes now, so its contract says so, its default line
  says "background work" rather than "rebake", and an eviction is reported against the page it could not
  drop with the operation named and the reason in the `cause`. `IsrStore`'s own docstring, `fileStore`'s,
  the `redisStore` example on the modes page and the preamble it type-checks against all said two methods;
  the example would have thrown `store.delete is not a function` at the first eviction, and `guarded`
  would have swallowed it.

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

## 0.9.1

### Patch Changes

- c6d2a30: A third pass over `any`: **60 → 38**, still zero `as any` — and the answer to a question item 33 had left
  open.

  **`never[]`, not `unknown[]`, is the bound a lifecycle decorator wants.** `@updated` and
  `@deferHydration` declared `value: (...args: any[]) => void`, with a comment saying a repo-wide
  type-check could not prove `unknown[]` safe. Measured on the shape nothing here contains:

  ```
  any[]      accepts `@updated after(n: number)`, and is `any`
  unknown[]  REFUSES it — TS1241, because a parameter is contravariant
  never[]    accepts it, and is not `any`
  ```

  So the signature did not need to lose its parameters; it needed the right bottom type. The same applies to
  every constructor CONSTRAINT — `@Host`, `@ShouldUpdateOnPropsChange`, and the `InstanceOf`/`PropsOf`/
  `HookPropsOf` helpers. `src/__tests__/DecoratorTypeClaims.tsx` pins it: put `unknown[]` back and two
  `TS1241`s appear, which is what a false green looked like.

  **And the opposite direction, which is the other half of the rule.** `@ramonda/router`'s
  `NoPropsHookClass` needed `unknown`, not `never`: it types a VALUE that must accept core's real
  `Runtime`, and a parameter typed `never` refuses it. `never` is right in a constraint, `unknown` is right
  in a value's parameter, and `any` was standing in for both.

  **Three types that were claiming the wrong thing, found because an `any` had been hiding them:**

  - `Effect.effect` was `() => undefined | (() => void)` while the runner guards with
    `typeof res === "function"` and ignores anything else. It is `() => unknown` now, with the one
    assumption named in an `isCleanup` predicate instead of bridged by an `any` in `attachEffect`.
  - `ComponentRuntime.rawProps` was `RenderableProps<any>`, which is the props SHAPE — but every reader
    treats it as a bag, and `debug/inspector.ts` already declared it as one. Typed
    `Record<string | symbol, unknown>`, it also deletes the two casts in `Component.ts` that said so.
  - `areStringRecordsEqual` took `Record<string, string | undefined>` and its one caller passes props,
    whose values are handlers and objects. Renamed `arePropsBagsEqual`, over `unknown` — the body only
    counts keys and compares with `!==`.

  `EnhancedHTMLNode._listeners` is `Record<string, EventListener>`, which is exactly what goes in and comes
  out of `add`/`removeEventListener`.

  The counting script now lives at `scripts/dev/count-any.mjs` rather than in a scratch directory, because
  the last two passes' numbers were not comparable once their script was gone.

## 0.9.0

### Minor Changes

- f5b8211: `params(pattern)` — the reading side typed from the pattern, and the pattern checked rather than trusted.

  `route("/u/:id", { id })` has typed the WRITING side from the pattern since the kit existed;
  `params<T>()` left the reading side as an annotation nobody verified. Now the type comes out of the
  pattern:

  ```tsx
  const { id } = this.route.params("/players/:id"); // id: string, nothing annotated
  ```

  Same `ParamNames` machinery, pointed the other way. It moved to `match.ts` — the leaf both sides can
  reach, since `createRouter` imports from `Router.tsx` and a type living there could not travel back.

  **The pattern is constrained to the patterns YOUR table declares.** `Pat extends ParamPath<C>`, so a
  route the table does not name is a type error and so is a static path, which has no params to read.
  That is a step past inferring from a string the caller made up, and it is the reason the kit is bound
  to one table at all.

  **And it is checked at runtime, which is the part that matters.** A named pattern is a claim about which
  route the component stands on, and an unchecked claim hands back `undefined` typed as `string`. Every
  `:name` in the pattern must be present in what the outlet matched, and it throws otherwise — naming both
  the pattern asked for and the route the component is actually on. It throws in every build, like
  `route("/u/:id", {})` which has always refused to build `/u/undefined`: same package, same class of
  mistake, same shape of message.

  **Deliberately not an equality check on the route key.** A component rendered by both `/players/:id` and
  `/users/:id` names one and is correct on both, because what it asked for is satisfied on both — the claim
  is about the params, not the spelling. When two routes genuinely disagree, `params<T>()` is still there
  and still the right door.

  `ParamsContextValue` now carries the matched `key` alongside the params, which is what lets the message
  say which route you are on. `matchCompiled` already computed it.

  **Measured before it was designed.** Every parameterised route in this repository — three of them, all
  with literal keys — and all six `params()` read sites had the same shape: one param, destructured
  immediately, `params<{ id: string }>().id`. All six lose the annotation. The one route table built in a
  loop (the docs site, 77 paths) has no params and reads none, so the case a computed key cannot type does
  not arise there.

  `TypedNavigator<P extends string>` is now `TypedNavigator<C extends RouteConfig>` — it needs the config
  to constrain the pattern, and it derives the href union from it as before.

## 0.8.0

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

## 0.7.0

### Minor Changes

- 7191ab6: `Link` and `Navigator` are reached through `createRouter`, and nowhere else.

  Both existed in two versions — the kit casts them so `href`, `push` and `replace` take only paths
  your table names — and the untyped one was an equally short import that silently gave up the
  checking the typed one exists to provide. Not one app in this repository was using `createRouter`
  when this was measured, which says the wrong door was not so much chosen as walked through.

  ```ts
  const { Router, RouteOutlet, Link, Navigator, route } = createRouter(routes);
  ```

  **Breaking.** `Link`, `LinkProps` and `Navigator` are no longer exported from the package. `Router`
  and `RouteOutlet` still are: the kit hands those back unchanged, so there is only one of each and
  nothing to pick wrongly.

  A second NAME for each was tried first and abandoned — it worked for `Link` only because HTML had a
  word for the raw thing, and there is none for a navigator. Five members would have meant five
  separate arguments about vocabulary; one door needs none.

  **`href` now takes a query, a fragment, and a filled-in `:param` path.** `route()` is no longer
  required for the ordinary case:

  ```tsx
  <Link href="/users/42" />
  <Link href={`/users/${id}`} />        // an id from a backend
  <Link href="/about?tab=2#top" />
  ```

  The looseness is only behind the `?`: a query needs at least one `key=value`, the path is still
  checked to the letter, and runtime concatenation (`"/a?" + q`) widens to `string` and is refused.
  Measured before it went in — 50 routes and 2100 href sites cost 0.39s of check time against 0.34s
  for a plain `string`, because TypeScript keeps these as patterns rather than expanding them.

  Two known costs, both written down where they bite: a substituted segment is `${string}`, which a
  slash also satisfies, so `/users/a/b` is accepted; and a raw `/users/:id` compiles, since `":id"` is
  a string like any other.

  `@ramonda/check` follows a kit destructured from a factory whose declaration is in the same program,
  not only one that arrives through an installed package's fragment. A monorepo compiles its own
  packages from source, which is why the fragment-only version passed every fixture and still failed
  this repository's own documentation site.

### Patch Changes

- c0df2d1: A kit member whose name answers to two classes resolves to nothing, and a built href takes a
  fragment.

  **`@ramonda/check`** — when a package hands a component back through a factory without exporting it,
  the fragment is read by name. Two exported classes sharing a name were already refused, "rather than
  resolved to whichever came last"; two INTERNAL ones kept the first and said nothing. Internal names
  collide far more often than exported ones — this repository's own documentation app declares
  `class Page` seventy-five times — and a kit member bound to an arbitrary class puts every edge below
  it under the wrong component. That is a wrong answer where an unresolved tag would have been an
  honest missing one. Both are now refused and the tag reports as the hole it is.

  No note is emitted for an internal collision, unlike the exported case: almost none of them is ever
  reached by a destructured key, and a note per collision would bury the runs where it matters.

  **`@ramonda/router`** — `AnyHref` is `Located` over both halves of the union, including the `Href`
  that `route()` builds. Written out by hand, the second half took a query but not a fragment, so
  `` href={`${route("/u/:id", { id })}#top`} `` was refused while `href="/about#top"` was accepted.
  An anchor into a section of a parameterised page is the ordinary reason to write one; the asymmetry
  was an omission, not a decision.

  Two JSDoc claims that this branch had already made false are corrected — `href` no longer requires
  `route()` for a `:param` path, and a raw `:param` pattern is accepted rather than rejected (a known
  cost, documented three lines above where the comment denied it).

  Docs: component examples import `Link` / `Navigator` from `./routes` instead of calling
  `createRouter(routes)` in each file. Every app in this repository mints the kit once and imports it,
  the setup page says to do exactly that, and eight examples across five pages taught the opposite —
  six of them destructuring three names to use one. The sample checker now resolves `./routes` to the
  real package's types, so `this.use(Navigator)` has to genuinely carry `push` and `params`; the
  hand-written `any` shims those examples leaned on are gone.

## 0.6.0

### Minor Changes

- ad994c9: A context can say that two of it conflict, and a second one is reported before the app runs.

  Nesting is ordinary: a second Provider shadows the first and the nearer one wins. That is how a
  theme override inside a panel works, and a form inside a form — so a checker cannot simply report
  every context provided twice.

  `createContext(…, { single: true })` is how an author says this one is different. The router's is the
  case, and it now declares it: two Routers both listen to `popstate` and both write history, and the
  first to unmount takes the listener the survivor depends on. `Router.init` already throws when it
  happens — this is the same fault said before anything renders, on every path the source can produce,
  including the branch nobody clicked.

  Like `label` and `optional`, the flag is a declaration rather than behaviour: the runtime reads
  neither, and it changes what is reported rather than what is read. It travels in a package's graph
  fragment, so a context declared single stays single in every app that mounts it.

## 0.5.0

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

## 0.4.1

### Patch Changes

- cb023eb: Follow core's lifecycle decorator rename

  Both packages use the lifecycle decorators in their own source — `@created({ env: "client" })` in the
  router's navigation counter, `@mounted` and `@destroyed` across the testing library's harness — so both
  had to be republished with the new names.

  **A published copy of either will not work with the renamed core.** They declare core as a peer with a
  range wide enough to admit it (`>=0.1.0 <1.0.0`), and that range cannot express "only the versions where
  these names exist", so npm will happily install the pair and the import fails at load with
  `create is not exported`. Upgrade the two alongside core rather than one at a time.

## 0.4.0

### Minor Changes

- 68f9163: JSX goes through an automatic runtime, and the factory is renamed `__h`

  Setting Ramonda up used to mean naming a factory (`jsxFactory: "__ramondaH"`), injecting it into
  every module, and declaring it in a `global.d.ts` — and then holding two names in your head, because
  the package exported `h` while compiled JSX called `__ramondaH`.

  Now the compiler imports what it needs, per file:

  ```jsonc
  { "jsx": "react-jsx", "jsxImportSource": "@ramonda/core" }
  ```

  ```js
  esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core" }
  ```

  No factory name, no `jsxInject`, no `jsx-shim.ts`, no global declaration. `npm create ramonda`
  writes it this way, and both templates lost a file each.

  **Breaking.** `h` is no longer exported; the factory is `__h`, for the vnodes a tag cannot express —
  a runtime tag name, spread children. Compiled JSX never calls it. To migrate, change the two config
  keys above, delete the inject and the global declaration, and rename any hand-written `h(` to `__h(`.

  Two new subpaths ship with core: `@ramonda/core/jsx-runtime` and `@ramonda/core/jsx-dev-runtime`.
  Both are needed — every bundler's development mode imports the second one.

  Fragments still do not exist. `<>…</>` throws with the reason rather than half-working, because one
  tag producing several elements is what the one-tag-one-element rule is about.

## 0.3.0

### Minor Changes

- 62d536e: ISR pages now live in a store you choose, instead of a `Map` in your server file.

  `@ramonda/router/server` gains `createIsrCache`, `memoryStore` and `fileStore`. The cache owns the
  timing — fresh, stale-while-revalidate, cold — and the store owns where pages are kept:

  ```ts
  import { createIsrCache, fileStore, routePlan } from "@ramonda/router/server";

  const isr = createIsrCache({
    plan: routePlan(server),
    store: fileStore({ dir: "dist/isr" }),
    render: bakePath,
  });

  // `undefined` means "not an ISR route" — fall through to static or dynamic.
  const page = await isr.serve(path);
  if (page) sendHtml(res, page.html, page.mode);
  ```

  **Why it needed to change.** A per-process `Map` is correct for one instance and wrong for two:
  each caches independently, so a visitor bounces between a copy baked ten seconds ago and one baked
  ten minutes ago with no way to tell which they got, and a restart empties it so every ISR route
  renders cold again — repeatedly, during a rolling deploy. `fileStore` fixes both for instances that
  share a volume; anything else is two methods (`get` / `set`) over Redis, a database, or whatever
  your instances do share.

  Two things the old inline version did not do:

  - **Single-flight.** Ten requests arriving while a stale page rebakes now start one render, not
    ten — the stampede a slow page under load used to produce.
  - **A failed background rebake keeps serving the stale page** rather than surfacing as an error. A
    failed _cold_ render still throws, because there is nothing else to send.

  The scaffolded SSR app uses `fileStore` and clears the cache in its prerender step, since pages
  baked by the previous bundle must not be served against a new client bundle.

### Patch Changes

- 4850a4e: A missing context provider (`RMD003`) is now reported when the consumer **mounts**, not when a
  value is first read — and nothing has to be declared to get it.

  The information was always in the hook: `this.use(ThemeConsumer)` names the context, and the
  consumer resolves its provider once, at construction. So the answer exists at mount. Waiting for a
  read gave the same answer later, and for a value read only down a branch nobody clicks, never at
  all — which is the fault worth catching: the page renders, the default fills in, nothing looks
  wrong.

  The report names the component the provider has to go above:

  ```
  [RMD003] Context consumed without a provider above it
  <Panel /> mounts ThemeConsumer with no Provider on any ancestor, so every key it reads
  gets the default below.
  ```

  `createContext` takes one new option, for the case where the default IS the answer:

  ```tsx
  const [ParamsProvider, ParamsConsumer] = createContext(
    { params: {} },
    { label: "RouteParams", optional: true }
  );
  ```

  The flag belongs to the context, not to each consumer — whoever wrote `createContext` is the one
  who knows whether the default is a real answer or a stand-in for something missing, and they say it
  once. The router's `params` context is marked `optional`, because a nav bar beside the outlet
  legitimately has no matched route above it. `@ramonda/check` honours the same flag, so the static
  and runtime checks agree.

  Development-only, as before: a production build reports nothing and reads exactly the same values.

- d1e56fc: Two regular expressions replaced with linear scans. Both were the same shape — `+` anchored at
  `$`, which cannot match when the string does not end in the run it is looking for, so the engine
  retries from every position and backtracks the whole run each time.

  **`normalizePathname` (router)** is the one that mattered: it reads
  `window.location.pathname`, so the string comes from whatever URL someone was handed. Measured on
  `"/".repeat(n) + "a"` — 30k slashes took 942ms, 60k took 3.7s. A link with enough slashes hung the
  tab that opened it. The scan handles 200k in about a millisecond.

  **`create-ramonda`** trimmed dashes off a derived package name the same way (`/^-+|-+$/g`); only a
  folder name reaches it, but it is published source, and two loops are the right way to trim
  anyway. Output is unchanged on all 17 shapes checked.

  **`ramonda-check-context`** derived the tsconfig's directory with a regex; it now uses
  `path.dirname`, which is what the operation is called. Reported by CodeQL. The analyzer's result is
  unchanged — same components, same contexts, same issues, verified against an absolute path, a
  relative one, and one already ending in a separator.

  Separately, two `console` calls built their message by interpolation and passed a value after it.
  A console treats its first argument as a **format string**, so a `%s` inside the interpolated part
  consumed the argument that followed — and in both cases that argument was the payload:

  ```
  of /about%s failed:  →  "of /aboutupstream down failed:"   (the error never printed)
  ```

  `createIsrCache`'s default `onError` lost the reason a rebake failed; the devtools log row lost the
  data you clicked it to see. Both now use a `%s` placeholder. Reported by CodeQL for the first one.

## 0.2.0

### Minor Changes

- a048edc: Add `@ramonda/router/server` — server-only per-route render config (`defineServer` + `routePlan`).

  `defineServer(routes, config, options?)` attaches a rendering mode to each route in the shared
  table, keyed by path. The config is **exhaustive**: every navigable path must have an entry, so
  adding a route to `createRoutes` fails type-checking until it is handled here, and an entry for a
  non-route is a type error too — the table and its server config cannot drift.

  ```ts
  // app/server/routes.ts  (SERVER ONLY)
  import { routes } from "../src/routes";
  import { defineServer } from "@ramonda/router/server";

  export const server = defineServer(routes, {
    "/": {}, // server (default)
    "/docs": { prerender: true }, // SSG
    "/pricing": { revalidate: 60 }, // ISR
    "/u/:id": { prerender: true }, // static per page (needs concrete paths to bake)
  });
  ```

  `routePlan(server)` partitions the table into `{ static, isr, server, needsData }` for the build.
  `options.defaultMode` (`"server"` default, or `"static"`) sets what an unmarked route does.

  Server-only by construction: it is a separate subpath (`@ramonda/router/server`) whose `browser`
  export condition resolves to a stub that throws, and `defineServer` throws at runtime in a browser
  too — so loaders, secrets, and DB access can never reach the client bundle. Keep it under a
  `server/` folder in your app.

  (The build-time guard that renders each opted-in route with the request context poisoned — proving
  a baked route reads no per-request data — builds on this and lands next.)

- edfe219: Type-safe routing: `createRouter(routes)` binds `<Link href>`, `route()`, and `Navigator`
  to the paths a route table actually declares — change a route and a stale link becomes a
  compile error.

  ```ts
  export const routes = createRoutes({ "/": <Home/>, "/u/:id": <Profile/> });
  export const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);

  <Link href="/" />                              // ✓
  <Link href="/nope" />                           // ✗ not a route
  <Link href={route("/u/:id", { id })} />         // ✓ params typed; missing/misspelled → error
  ```

  - `createRoutes` now captures its path literals in the type (via `<const>`), carried on a
    phantom `RouteConfig<Paths>` that defaults to `string` — **fully backward-compatible**, every
    existing `createRoutes`/`RouteConfig`/`RouteOutlet` usage is unchanged.
  - `href` accepts a **static path or an `Href` from `route()`**; a raw `:param` pattern
    (`"/u/:id"`) is rejected — it would type-check but render a literal `:id`, so it must go
    through `route()`, which fills and URL-encodes the params. `Navigator.push`/`replace` are
    typed the same way.
  - The existing untyped `Link`/`Navigator`/`Router`/`RouteOutlet` exports still work; the factory
    is the typed path. New exports: `createRouter`, `PathOf`, `Href`, `TypedLinkProps`,
    `TypedNavigator`, `TypedRouterKit`.

## 0.1.0

### Minor Changes

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

### Patch Changes

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

## 0.0.4

### Patch Changes

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

## 0.0.3

### Patch Changes

- 7b530bb: Route guards now work on the server's first load.

  A guard that navigates during a server render — e.g. a `@mounted` that calls
  `nav.replace("/login")` when the visitor is not authenticated — used to be a no-op
  on the server: it wrote to a history that does not exist and the wrong page was sent,
  then the client re-read `window.location` on hydration and snapped back.

  The `<Router>` now captures the render's redirect sink (core's
  `captureServerRedirect`) at construction. On the server, a navigation records the
  target and stops — no history write, no re-render of a tree the response will
  discard — and `renderToString` turns that into a thrown `ServerRedirect` for the
  server to answer with a 302. On the client, navigation is unchanged. First guard to
  fire decides the destination.

- 7b530bb: Race-free URL state, clearer names, and scroll as an explicit choice.

  **New: partial-state updaters.** `updateSearchParams(next, opts?)` and
  `updateHashTags(next, opts?)` change only the query or only the hash. The functional
  form receives the freshest state, so two filters changed in the same tick serialize
  instead of clobbering each other. They stay in place (no scroll) unless `{ scroll: true }`
  is passed, and default to a new history entry (`{ replace: true }` to avoid filling
  history while typing). Available on both `Navigator` and the `Router` instance.

  **BREAKING: `RouteHook` is renamed to `Navigator`.** `Router` (mounted once at the
  root) and the everyday hook were too easy to confuse; `Navigator` reads distinctly and
  can't be pulled in by accident. Replace `this.use(RouteHook)` with `this.use(Navigator)`.

  **BREAKING: the `shallow` option is removed** (from `<Link>` and `NavigateOptions`).
  Routes match on the path only, so a query- or hash-only change never re-matches — it is
  inherently a same-page update, with nothing to "skip". The one real choice, scrolling,
  is now explicit: `push`/`replace`/`<Link>` scroll to the top by default (pass
  `scroll: false` to stay put), while the in-place updaters don't scroll unless asked.

  `Router` now also exposes the read/navigate surface (`pathname`, `searchParams`,
  `hashTags`, `push`, `replace`, `updateSearchParams`, `updateHashTags`, `back`,
  `forward`) — everything a `Navigator` has except `params()`, which needs a
  `<RouteOutlet>` below it.

- Updated dependencies [7b530bb]
- Updated dependencies [72fb118]
- Updated dependencies [7b530bb]
- Updated dependencies [30979b6]
- Updated dependencies [7b530bb]
  - @ramonda/core@0.0.2

## 0.0.2

### Patch Changes

- 2763298: Normalize a trailing slash in the router's pathname, so a route still matches when the host serves it with one — e.g. a static host serving `dir/index.html`, or Cloudflare Pages 308-redirecting `/x` to `/x/`. Without this, a direct load or reload of any non-root route fell through to `*` and rendered a 404.
