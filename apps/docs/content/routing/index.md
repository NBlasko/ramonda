---
title: Setup
description: Add routing with two pieces — a Router that tracks the URL, and an outlet that shows the matching page.
section: Routing
order: 70
---

# Routing

Most apps are more than one page — a home screen, a profile, a settings panel.
**Routing** is showing the right one for the current URL and switching between them
without a full page reload. Ramonda's router is a separate package:

```
pnpm add @ramonda/router
```

You write a **route table** with `createRoutes`, then `createRouter` hands you the pieces bound
to it: **`Router`** (tracks the URL), **`RouteOutlet`** (shows the matching page), **`Link`** and
**`Navigator`** (below), and **`route`** (for `:param` links).

```tsx
import { Component } from "@ramonda/core";
import { createRoutes, createRouter } from "@ramonda/router";

export const routes = createRoutes({
  "/": <Home />,
  "/players/:id": <Player />,
  "*": <NotFound />,
});

export const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);

export class App extends Component {
  router = this.use(Router);

  render() {
    return (
      <div className="app">
        <NavBar />
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
```

Put this in one module — `routes.ts` in the examples that follow — and import `Link` / `Navigator` /
`route` / `routes` from it across your app. Call `createRouter` **once**, there: it is the only
place `Link` and `Navigator` come from, and binding them to your table is what makes links
**type-safe** — next.

```demo:RouteInfo
```

(That demo reads the router of *this* site — these docs are a Ramonda app, so the
values are real.)

## The routes table

`createRoutes` maps each URL pattern to what to show:

- `"/"` — the home page.
- `"/players/:id"` — a pattern; `:id` matches any value, and the page can read it (see
  [params](/routing/params)).
- `"*"` — the fallback for when nothing else matches (a "not found" page).

Call it **once**, at the top of a module — not inside `render()` — so the patterns
are compiled a single time.

## `Router` is a hook; `RouteOutlet` is where the page goes

You add `Router` with `this.use(Router)` on your top component: it tracks the URL and
adds no element of its own. `RouteOutlet` is the component you place where the routed
page should appear.

Keeping the two separate is what lets a nav bar sit *beside* the outlet and stay put
as you move around — only the outlet's content swaps, everything around it keeps its
state:

```tsx
<div>
  <NavBar />                        {/* stays as you navigate */}
  <RouteOutlet routes={routes} />   {/* this is what changes */}
</div>
```

## Links are type-checked against your routes

Because `createRouter` knows your table, `<Link href>` only accepts a real path — change or
rename a route and every stale link becomes a **compile error**, not a broken link you find by
clicking:

```tsx expect-error
import { Link, route } from "./routes";

<Link href="/">Home</Link>                          // ✓
<Link href="/nope">Home</Link>                       // ✗ not a route
<Link href={route("/players/:id", { id: "9" })}>…</Link>  // ✓ params typed; a missing/misspelled param errors
```

A static path goes in directly; a `:param` path must be built with `route(...)`, which fills the
params and rejects a wrong one. The same paths type `Navigator.push` / `replace`. More in
[links](/routing/links).

## One Router per app

Mounting a second `Router` while one is live throws — there is a single source of
truth for the URL, and two would disagree. (Unmounting one and mounting another is
fine, so tests and hot reload work.)

## Why route through it at all

You could set `window.location` yourself. What the router buys you is that **every
change to the URL goes through one channel**, and each one starts from the freshest
state — even the imperative `push` and a `<Link>` click share it. So two navigations
that land in the same tick serialize instead of clobbering each other: no lost update
where one write reads stale state and overwrites the other. URL bugs that only show up
under fast clicks or async races simply don't have a place to happen.

The other half is that **the URL is a place to keep state**. A selected tab, an open
filter, a search query — put it in the URL and it survives a reload, it's shareable as
a link, and Back undoes it. See [keeping state in the URL](/routing/params#keep-ui-state-in-the-url).

## Next

- [Links](/routing/links) — moving around without breaking what a real link does.
