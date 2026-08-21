---
"@ramonda/router": minor
---

`routePlan`'s `static` holds paths, never patterns — and a `:param` route marked for prerender now
stops the build unless it is given them.

`/guide/state` is one page; `/guide/:slug` is one route and however many guides there are. The pattern
went into `plan.static` as itself, and a build loop bakes what it is handed — so it wrote
**`dist/static/guide/:slug/index.html`**, a directory literally named `:slug`, a page no request can
reach, and nothing said a word. The sibling in `match.ts` had this right from the start: `routePaths`
puts a parameterised route in `needsData` and keeps it out of `paths`.

```ts
const plan = routePlan(server, GUIDES.map((slug) => `/guide/${slug}`));
// plan.static    → ["/", "/guide/state", "/guide/effects", "/signup"]
// plan.needsData → ["/guide/:slug"]
```

With none supplied it **throws**, naming the route and spelling the call with the route's own param
name. It stops rather than skipping the route or falling it back to the server, for the same reason
`renderStatic`'s `blockedBy` stops it: a config that says `prerender` and a build that quietly does not
is how a site ships missing half its pages while every page it emitted looks perfectly correct.

ISR is not held to it. A `revalidate` route with a `:param` is served and refreshed per request, so its
pattern is a rule rather than a page and there is nothing for a build to bake; it stays named in
`needsData` for a build that wants to warm those pages.

**Every path given has to be baked**, which the first version of this left open: `filled` only refused
a route that matched NOTHING, so one good path silenced it and the rest were dropped without a word —
measured, `["/guide/ok", "/guide/v1.2"]` came back as `["/guide/ok"]`. A `:param` matches one segment of
`[\w-]+`, so a trailing slash, a dot, a percent-encoded character or a typo'd prefix all fall outside
it, and dropping them silently is the very failure this throw exists to prevent. Found by review.

The two faults also have two messages now. "Pass them" is for a call with no paths; a call whose paths
do not match says so and names them, instead of sending a reader to add an argument that is already
there.

**And one thing this does NOT fix, now stated rather than claimed:** `revalidate` on a route with a
`:param` is accepted and does nothing. `plan.isr` carries the PATTERN, `createIsrCache` keys its window
map by that string and looks it up exactly, so `serve("/u/7")` finds nothing under `/u/:id` and the page
renders per request with the real request context — no shared cache, the opposite of what `revalidate`
asks for. An earlier version of this branch's own comment claimed such a route "is served and refreshed
per request" and that a build could "warm those pages"; neither is true. The docs now tell a reader not
to use it yet, and making it work or refusing it is a decision about a published API rather than a fix.

`paths` is optional, so a table with no parameterised static route calls this exactly as before.

**Dogfooded rather than argued.** `playground-ssr` gained `/guide/:slug` as a bakeable parameterised
route beside the per-request `/users/:id` — same shape, opposite mode, which is the point: whether one
is baked is the app's declaration. The real build writes both guides to real files, the smoke test
asserts one is served from a file with its content in it, and removing the supplied paths stops the
build with the message above.
