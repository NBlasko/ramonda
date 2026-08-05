---
title: Params, query and hash
description: Read the current URL inside a component — path params, the query string, the hash.
section: Routing
order: 72
---

# Reading the URL

To read the current URL inside a component — the `id` in `/players/9`, a `?query`, a
`#hash` — use `Navigator`:

```tsx
import { Navigator } from "@ramonda/router";

export class Player extends Component {
  route = this.use(Navigator);

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

## Keep UI state in the URL

A tab, a filter, a search query — anything you'd reach for `@state` to hold can instead
live in the URL. Then it survives a reload, it's shareable as a link, and Back undoes
it, all for free. Read it with `searchParams`, and change it with `updateSearchParams`:

```tsx
import { Navigator } from "@ramonda/router";

export class Filters extends Component {
  route = this.use(Navigator);

  setColor(color: string) {
    this.route.updateSearchParams((prev) => ({ ...prev, color }));
  }
  setSize(size: string) {
    this.route.updateSearchParams((prev) => ({ ...prev, size }));
  }
}
```

Three things make this the right tool for fast-changing state like a filter panel:

- **It touches only the query.** `pathname` doesn't change, so the route never
  re-matches — no page swap, cheap on every keystroke. (Routes match on the path only;
  the query is never part of a route pattern.)
- **It stays put.** No scroll to the top, so filtering a long table doesn't yank you
  away from it. Pass `{ scroll: true }` on the rare time you want the jump.
- **It's race-free.** Give it a function and it receives the *freshest* params, so two
  filters changed in the same instant don't clobber each other — the second reads the
  first's write. This is why the functional form matters: `setColor` and `setSize`
  firing together both land, instead of one silently dropping the other.

Pass a plain object instead of a function to replace the query outright. And by default
each change is a new history entry, so Back steps through them; pass `{ replace: true }`
(e.g. while someone is typing) to avoid filling the history.

The same `updateHashTags` exists for the hash, with the same options.

## Next

- [Navigating](/routing/navigating) — push, replace, back, forward.
