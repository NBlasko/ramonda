---
title: Navigating
description: push, replace, back and forward — state-first, and the methods stay bound.
section: Routing
order: 83
---

# Navigating

```tsx
export class Toolbar extends Component {
  route = this.use(RouteHook);

  render() {
    return (
      <nav>
        <button onClick={this.route.back}>← Back</button>
        <button onClick={() => this.route.push("/players/9")}>Player 9</button>
      </nav>
    );
  }
}
```

| | |
|---|---|
| `push(href, opts?)` | navigate, adding a history entry |
| `replace(href, opts?)` | navigate without adding one |
| `back()` / `forward()` | move through history |

`opts.scroll` scrolls to the top after navigating.

## The methods stay bound

`onClick={this.route.back}` works — the hook's methods are bound like any other, so passing one
as a handler does not lose `this`. There is no `() => this.route.back()` wrapper to write.

## State first, then the URL

A navigation updates the store and *then* syncs history. The URL is never read back except at
startup and on `popstate`.

That ordering is what makes it race-free. Reading the URL back after writing it means the render
depends on when the browser got round to updating `location` — and two navigations in one turn
can then resolve in the wrong order. Here the store is the single source of truth and the URL is
an output of it.

## `push` or `<Link>`?

Use [`<Link>`](/routing/links) whenever the thing *is* a link — a person should be able to
middle-click it, and a crawler should be able to follow it.

Use `push` for a navigation that is the result of something else: a form that submitted, a
selection that resolved, a redirect after a save.

## There is no imperative router outside components

You cannot `import { router }` and call `push` from anywhere. That is deliberate: a module-level
router is shared by every concurrent request on a server, so one request's navigation would be
visible to another.

Navigation is reachable from inside the tree, through `RouteHook`. If a plain function needs to
navigate, take a callback — the component that calls it has the hook.

## Next

- [Nested outlets](/routing/nested) — routes inside routes.
