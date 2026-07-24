---
title: Params, query and hash
description: Read the current URL inside a component — path params, the query string, the hash.
section: Routing
order: 72
---

# Reading the URL

To read the current URL inside a component — the `id` in `/players/9`, a `?query`, a
`#hash` — use `RouteHook`:

```tsx
export class Player extends Component {
  route = this.use(RouteHook);

  render() {
    const { id } = this.route.params<{ id: string }>();
    return <article>Player {id}</article>;
  }
}
```

What it gives you:

| | |
|---|---|
| `pathname` | `/players/9` |
| `params<T>()` | the `:params` the route matched (needs a `<RouteOutlet>` above) |
| `searchParams` | `?a=1&b=2` → `{ a: "1", b: "2" }` |
| `hashTags` | the `#…` segments |

## You react to the part you read

`pathname` and `searchParams` are tracked separately: a component reading only
`pathname` doesn't re-render when a query parameter changes, and vice versa. You get
that for free — and it's why a plain `<Link>` (which reads none of it) doesn't
re-render on every navigation.

## `params` needs an outlet

`params()` comes from the `<RouteOutlet>` that matched, so it only means something
inside the routed page. A nav bar beside the outlet has `pathname` but no params —
which is right, it isn't part of any route.

## Params are always strings

They come out of a URL, so they are strings. Parse them where you use them, and treat
a missing or malformed one as a real possibility — a URL is user input.

## Next

- [Navigating](/routing/navigating) — push, replace, back, forward.
