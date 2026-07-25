# @ramonda/router

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
