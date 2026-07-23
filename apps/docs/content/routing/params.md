---
title: Params, query and hash
description: RouteHook reads the URL, and reads are per key.
section: Routing
order: 82
---

# Reading the URL

`RouteHook` gives a component the current route.

```tsx
export class Player extends Component {
  route = this.use(RouteHook);

  render() {
    const { id } = this.route.params<{ id: string }>();
    return <article>Player {id}</article>;
  }
}
```

| | |
|---|---|
| `pathname` | `/players/9` |
| `params<T>()` | the matched route's `:params` — needs a `<RouteOutlet>` above |
| `searchParams` | `?a=1&b=2` → `{ a: "1", b: "2" }` |
| `hashTags` | `#tab=film#play=5` → ordered segments |

## Reads are per key

`pathname` and `searchParams` are separate signals. A component reading only `pathname` is **not**
re-rendered when a query parameter changes, and vice versa.

That is not an optimisation you switch on — it falls out of how the route state is published. It
also means a plain `<Link href="…">` with no dynamic behaviour subscribes to nothing at all, so a
navigation does not re-render every link in your nav bar.

## `params` needs an outlet

`params()` comes from the `<RouteOutlet>` that matched, so it is only meaningful inside the routed
subtree. A nav bar sitting beside the outlet has `pathname` but no params — which is correct: it
is not part of any route.

## Typing params

```tsx
const { id } = this.route.params<{ id: string }>();
```

Params are always strings — they come out of a URL. Parse them where you use them, and treat a
missing or malformed one as a real case: a URL is user input.

## Next

- [Navigating](/routing/navigating) — push, replace, back, forward.
