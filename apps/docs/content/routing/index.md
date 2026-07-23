---
title: Setup
description: Router is a hook on your app root, and RouteOutlet renders the match.
section: Routing
order: 80
---

# Routing

```
pnpm add @ramonda/router
```

Two pieces. `Router` owns the route state; `RouteOutlet` renders whichever route matches.

```tsx
import { Component, Host } from "@ramonda/core";
import { Router, RouteOutlet, createRoutes } from "@ramonda/router";

const routes = createRoutes({
  "/": <Home />,
  "/players/:id": <Player />,
  "*": <NotFound />,
});

@Host("div")
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

```demo:RouteInfo
```

That demo is reading the router of **this site** — the documentation you are looking at is a
Ramonda app, so the values are real.

## `Router` is a hook, not a component

This is the design decision worth understanding, because it is not what other frameworks do.

A `<Router>` component would have to **be** an element — Ramonda is 1-1 — so it would wrap your
whole app in a node you did not ask for. And it could not be the thing that renders the matched
route *and* the thing that wraps the nav bar, because those are different positions in the tree.

So the two jobs are split. `Router` is a hook on your app root: it owns the store, publishes it
to the subtree as context, and adds no element. `RouteOutlet` is a component that renders the
match, and it sits wherever the routed content belongs.

**That split is what makes chrome around the outlet work.** A nav bar beside the outlet keeps its
state across navigation, because nothing above the outlet is swapped:

```tsx
<div>
  <NavBar />              {/* not remounted on navigation */}
  <RouteOutlet routes={routes} />
</div>
```

## `createRoutes` — call it once

```tsx
const routes = createRoutes({ "/": <Home />, "*": <NotFound /> });
```

At module scope, not inside `render()`. It compiles each pattern to a regex once, and the stable
object identity lets `RouteOutlet` skip work when its parent re-renders.

`"*"` is the fallback for a path that matches nothing. It has no URL of its own — for a real 404
page on a static host, render one explicitly at the path your host expects.

## Only one Router

Mounting a second one while the first is live throws. The store is the single source of truth for
the URL, and two of them would disagree the moment either navigated.

The check counts live instances rather than latching, so unmounting the first and mounting
another — a test, a hot reload — works.

## Next

- [Links](/routing/links) — navigating without losing what a real `<a>` gives you.
