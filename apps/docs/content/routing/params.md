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
import { createRoutes, createRouter } from "@ramonda/router";

const routes = createRoutes({ "/players/:id": <Profile /> });
export const { Navigator } = createRouter(routes);

export class Player extends Component {
  route = this.use(Navigator);

  render() {
    const { id } = this.route.params("/players/:id");
    return <article>Player {id}</article>;
  }
}
```

The table is in the example on purpose: the pattern you name is **checked against it**, so the two
cannot drift. In a real app the kit is minted once and imported — `import { Navigator } from "./routes"`
— and the check comes with it.

**Name the pattern and the type comes out of it.** `id` is a `string` with nothing annotated, and the
pattern is checked against the table your kit was built from — a route that table does not declare is
a type error, and so is a static path, because it has no params to read. That is the same machinery
`route("/players/:id", { id })` has always used for building an href, pointed the other way.

What it gives you:

| | |
|---|---|
| `pathname` | `/players/9` |
| `params(pattern)` | the `:params` of that pattern, typed from it |
| `params<T>()` | the same values, typed by what you assert — the untyped door |
| `searchParams` | `?a=1&b=2` → `{ a: "1", b: "2" }` |
| `hashTags` | the `#…` segments |

## You react to the part you read

`pathname` and `searchParams` are tracked separately: a component reading only
`pathname` doesn't re-render when a query parameter changes, and vice versa. You get
that for free — and it's why a plain `<Link>` (which reads none of it) doesn't
re-render on every navigation.

## The pattern is checked, not trusted

A named pattern is a claim about which route the component is standing on, and a claim nothing
verifies is worth nothing: if the outlet above matched a route with no `:id`, `params("/players/:id").id`
would be `undefined` where the type says `string`, and it would travel. So every `:name` in the pattern
has to be present in what the outlet matched, and it **throws** otherwise — naming both the pattern you
asked for and the route you are actually on. It is the mirror of `route("/u/:id", {})`, which has always
refused to build `/u/undefined`.

It is **not** an equality check on the route key. A component rendered by both `/players/:id` and
`/users/:id` names one of them and is correct on both, because what it asked for is satisfied on both —
the claim is about the params, not the spelling. When two routes genuinely disagree about their params,
that is what `params<T>()` is for.

**Does naming the route make the component less reusable?** It names a coupling that was already there:
`params<{ id: string }>()` needed a route supplying `id` just as much, it simply failed silently instead
of saying so. And a component that is genuinely reusable should not be reading the URL at all — have the
page read the param and pass it down, `<UserAvatar userId={id} />`, for the same reason a value one child
needs is a prop rather than a context. If a component reads `params()`, it *is* part of a route; the
pattern only writes that down.

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
import { Navigator } from "./routes";

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
