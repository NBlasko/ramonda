---
title: Navigating
description: Move around from code — push, replace, back and forward.
section: Routing
order: 73
---

# Navigating

`Navigator` lets a component navigate from code:

```tsx
import { Navigator } from "./routes";

export class Toolbar extends Component {
  route = this.use(Navigator);

  // A method, not an inline arrow: a handler built during render is re-attached to
  // the element on every render, and development builds report it (RMD020).
  showPlayer() {
    this.route.push("/players/9");
  }

  render() {
    return (
      <nav>
        <button onclick={this.route.back}>← Back</button>
        <button onclick={this.showPlayer}>Player 9</button>
      </nav>
    );
  }
}
```

| | |
|---|---|
| `push(href, opts?)` | go to a URL, adding a history entry |
| `replace(href, opts?)` | go there without adding one |
| `updateSearchParams(next, opts?)` | change only the query — see [keeping state in the URL](/routing/params#keep-ui-state-in-the-url) |
| `updateHashTags(next, opts?)` | change only the hash |
| `back()` / `forward()` | move through history |

## Scrolling is your choice, per call

A `push` or `replace` moves to another page, so it scrolls to the top by default.
Pass `{ scroll: false }` to stay where you are — useful when a `<RouteOutlet>` sits
partway down a long page and you don't want the jump. The in-place updaters
(`updateSearchParams`, `updateHashTags`) are the opposite: they *don't* scroll unless
you ask with `{ scroll: true }`.

## The methods are already bound

`onclick={this.route.back}` works as-is — the hook's methods are bound to it, so
passing one as a handler keeps working. No `() => this.route.back()` wrapper needed.

## `push` or `<Link>`?

Use [`<Link>`](/routing/links) when the thing *is* a link — someone should be able to
middle-click it and a crawler should follow it. Use `push` when the navigation is the
result of something else: a submitted form, a resolved choice, a redirect after a
save.

## The `Router` hook can do this too

The component that mounts the router with `this.use(Router)` doesn't need a separate
`Navigator` to read the URL or navigate — the `Router` instance exposes the same
`pathname`, `searchParams`, `hashTags`, `push`, `replace`, `updateSearchParams`,
`updateHashTags`, `back` and `forward`, on top of the setup work it does. It's the same
surface, from the piece that owns the state:

```tsx
export class App extends Component {
  router = this.use(Router);

  goHome() {
    this.router.push("/");
  }

  render() {
    return (
      <div className="app">
        <button onclick={this.goHome}>{this.router.pathname}</button>
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
```

The one thing it can't give you is `params()` — those are matched by a `<RouteOutlet>`,
which sits *below* the Router, so only a `Navigator` inside a routed page has them.

## There is no global router

You can't `import` the router and call `push` from just anywhere — navigation is
reachable only from inside the tree, through `Navigator`. (A module-level router would
be shared by every request on a server, so one visitor's navigation could show up for
another.) If a plain function needs to navigate, pass it a callback — the component
calling it has the hook.

## Next

- [Nested outlets](/routing/nested) — routes inside routes.
