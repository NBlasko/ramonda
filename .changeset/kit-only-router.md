---
"@ramonda/router": minor
"@ramonda/check": minor
---

`Link` and `Navigator` are reached through `createRouter`, and nowhere else.

Both existed in two versions — the kit casts them so `href`, `push` and `replace` take only paths
your table names — and the untyped one was an equally short import that silently gave up the
checking the typed one exists to provide. Not one app in this repository was using `createRouter`
when this was measured, which says the wrong door was not so much chosen as walked through.

```ts
const { Router, RouteOutlet, Link, Navigator, route } = createRouter(routes);
```

**Breaking.** `Link`, `LinkProps` and `Navigator` are no longer exported from the package. `Router`
and `RouteOutlet` still are: the kit hands those back unchanged, so there is only one of each and
nothing to pick wrongly.

A second NAME for each was tried first and abandoned — it worked for `Link` only because HTML had a
word for the raw thing, and there is none for a navigator. Five members would have meant five
separate arguments about vocabulary; one door needs none.

**`href` now takes a query, a fragment, and a filled-in `:param` path.** `route()` is no longer
required for the ordinary case:

```tsx
<Link href="/users/42" />
<Link href={`/users/${id}`} />        // an id from a backend
<Link href="/about?tab=2#top" />
```

The looseness is only behind the `?`: a query needs at least one `key=value`, the path is still
checked to the letter, and runtime concatenation (`"/a?" + q`) widens to `string` and is refused.
Measured before it went in — 50 routes and 2100 href sites cost 0.39s of check time against 0.34s
for a plain `string`, because TypeScript keeps these as patterns rather than expanding them.

Two known costs, both written down where they bite: a substituted segment is `${string}`, which a
slash also satisfies, so `/users/a/b` is accepted; and a raw `/users/:id` compiles, since `":id"` is
a string like any other.

`@ramonda/check` follows a kit destructured from a factory whose declaration is in the same program,
not only one that arrives through an installed package's fragment. A monorepo compiles its own
packages from source, which is why the fragment-only version passed every fixture and still failed
this repository's own documentation site.
