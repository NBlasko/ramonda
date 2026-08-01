---
"@ramonda/router": minor
---

Type-safe routing: `createRouter(routes)` binds `<Link href>`, `route()`, and `Navigator`
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
