---
title: Navigating
description: Move around from code — push, replace, back and forward.
section: Routing
order: 73
---

# Navigating

`RouteHook` lets a component navigate from code:

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
| `push(href, opts?)` | go to a URL, adding a history entry |
| `replace(href, opts?)` | go there without adding one |
| `back()` / `forward()` | move through history |

`opts.scroll` scrolls to the top after navigating.

## The methods are already bound

`onClick={this.route.back}` works as-is — the hook's methods are bound to it, so
passing one as a handler keeps working. No `() => this.route.back()` wrapper needed.

## `push` or `<Link>`?

Use [`<Link>`](/routing/links) when the thing *is* a link — someone should be able to
middle-click it and a crawler should follow it. Use `push` when the navigation is the
result of something else: a submitted form, a resolved choice, a redirect after a
save.

## There is no global router

You can't `import` the router and call `push` from just anywhere — navigation is
reachable only from inside the tree, through `RouteHook`. (A module-level router would
be shared by every request on a server, so one visitor's navigation could show up for
another.) If a plain function needs to navigate, pass it a callback — the component
calling it has the hook.

## Next

- [Nested outlets](/routing/nested) — routes inside routes.
