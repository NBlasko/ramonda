# @ramonda/router

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

  A guard that navigates during a server render — e.g. a `@mount` that calls
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
