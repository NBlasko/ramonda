# @ramonda/router

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
