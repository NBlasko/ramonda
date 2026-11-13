# Proposal: route tables a module owns

Status: **approved** 2026-11-13, with every recommendation below (decisions 1–2, review A–C). Not built. Builds on [DESIGN.md](./DESIGN.md), which is built.

## The problem

An app grows in feature modules — `src/modules/tournaments/`, `src/modules/auth/` — and a module should be
liftable into a package of its own one day, unchanged. Routes are what stops it today.

- **One table, one registration.** `interface Register { routes: typeof routes }` holds the app's whole table. A
  module's `<Link href="/tournaments/7">` is checked against it — which works while the module is inside the app,
  and fails the day the module is built on its own: there is no table in that program, and every literal href
  is refused as unregistered.
- **A table cannot be assembled from parts.** `createRoutes` returns a COMPILED table (`{ compiled, fallback }`).
  Spreading one into another — `createRoutes({ ...tournamentRoutes, "/": <Home /> })` — copies `compiled` and
  `fallback` as if they were paths. Measured: the compiler refuses it (TS2345), and `ramonda-check` does not follow
  it either — it missed both planted `params()` faults in the modules' pages and reported both modules' tables as
  handed to no outlet.
- **A route that exists in one environment only** — debug pages behind `import.meta.env.DEV` — is in the type in
  every environment. A link to it type-checks in production code and lands on the catch-all there; the dev
  diagnostics never see it, because in development the route exists.

## The proposal

### 1. The app registers its table — under a name, so an extracted module can register beside it

```tsx
// src/routes.tsx — the app's table, assembled from parts (section 2)
export const routes = createRoutes(tournamentRoutes, authRoutes, { "/": <Home />, "*": <NotFound /> });

declare module "@ramonda/router" {
  interface Routes {
    app: typeof routes;
  }
}
```

`Register { routes }` becomes `Routes { [name]: table }`. TypeScript merges every declaration of an interface, so
`Href`, `push`, `route()` and `params(pattern)` accept a path from ANY registered table.

- **While a module is inside the app, it registers nothing.** The app's table holds every module's routes, so every
  link in every module is checked against it — one registration, as today. A registration per module would add
  nothing in the app, and would not even catch a hidden dependency: a link into another module's route passes
  through the app's registration. Only `ramonda-check` can see that crossing (section 4).
- **A module lifted into a package registers its own slice**, in its `routes.tsx` — one block, mechanical, the
  kind of edit an extraction command writes:

  ```tsx
  declare module "@ramonda/router" {
    interface Routes {
      tournaments: typeof tournamentRoutes;
    }
  }
  ```

  In the package's own build only that slice is registered: its links are checked against its own routes, and a
  link to another module's route is refused until it imports that module's public `routes` file. In the app both
  registrations merge, and a path in both is the same path twice in a union — harmless.
- **The name is why it is keyed.** One `routes` property cannot hold the app's table and a package's at once; two
  names can.
- **Paths are absolute.** The module owns its prefix (`/tournaments/…`); the app does not mount it somewhere. A path
  is read in one place, found by a search, and nobody adds prefixes in their head.
- **A module with no pages has no table.** A reusable unit that links takes an `href: Href` prop and the app
  supplies it — measured in [DESIGN.md](./DESIGN.md): a package's `.d.ts` typed with `Href` is checked in the app.
- **Two tables under one name** are a compile error (`Subsequent property declarations must have the same type`),
  which is the right answer for a name clash.

**Measured in a scratch program, 2026-11-13** (the router's own types, a prototype of the keyed registration):

| program | `/tournaments/7` | `/login` (another module) | `/nope` |
|---|---|---|---|
| the app, every table registered | accepted | accepted | refused |
| the tournaments module alone, its slice registered | accepted | refused | refused |

### 2. `createRoutes` takes parts

```tsx
// src/routes.tsx — the app assembles its table
export const routes = createRoutes(tournamentRoutes, authRoutes, {
  "/": <Home />,
  "*": <NotFound />,
});
```

- One name for one job: a single literal table is the one-part case, and every table written today keeps working.
- A part is a compiled table or a literal one; the result keeps the parts' order, which is the matching order.
- The type is the union of the parts' paths. Measured: `combine(tournamentRoutes, …)` refused `"/nope"` and accepted
  every part's paths.
- **A spread stays refused** — by the compiler, as now. Nothing to support.

### 3. A part that exists under a condition

```tsx
export const routes = createRoutes(
  tournamentRoutes,
  import.meta.env.DEV ? debugRoutes : undefined,
  { "/": <Home /> },
);
```

`undefined` is a part that adds nothing. The TYPE includes the debug paths in every environment — measured, and it
cannot be otherwise: the compiler sees one program, where `import.meta.env.DEV` is a `boolean`. So this is a
**`ramonda-check` rule**:

- a part under a condition — the build's (`import.meta.env.DEV`, the guards `dev-guard` already knows) or the app's
  own (`features.admin`) — marks its routes as existing only under that condition;
- a `<Link href>`, `push`, `replace` or `route()` naming one of them, from code NOT under the same condition, is an
  error: *"/debug exists only in development, and this link is in code a production build keeps — put it under
  `if (import.meta.env.DEV)`, or link somewhere every build has."*
- the debug pages' own links, and links under the same condition — the same name, or the same expression — are
  silent.

### 4. What `ramonda-check` learns

- **A table's parts.** An argument of `createRoutes` that is a name is followed to the `createRoutes` it holds, as a
  table built in a loop already is, and a conditional's arms are both read. Without this, measured above: missed
  faults and a false report on every module's table.
- **The condition rule** of section 3.
- Later, with the module boundaries (a direction of its own, not in this proposal): a link
  into another module's routes is a crossing that module's public `routes` file has to be imported for.

## What changes

- `interface Register { routes }` → `interface Routes { [name]: … }`. Pre-1.0, no migration path: every docs page,
  template and app that registers changes one line.
- The unregistered message names the new shape:
  `Register your routes: declare module '@ramonda/router' { interface Routes { app: typeof routes } }`.
- An app registers its table under `app` in the templates; the name is free, and only an extracted module adds another.

## Costs and risks

- **Type cost** grows with the number of slices. Measured in DESIGN.md: 1,000 routes in one table cost the same
  as before; many slices of the same total must be measured before this is built.
- **Matching order across parts.** `/tournaments/new` in one part and `/tournaments/:id` in an earlier one: the
  earlier wins, as within one table today. Across files it is harder to see — see question 2.
- **The checker work is the larger half.** Sections 3 and 4 are rules and graph work; the type change is small.

## What this narrows

The runtime narrows nothing: every table written today still works, and `createRoutes` and `defineServer` only gain
parts. What narrows is what `ramonda-check` accepts, and the rule for that is the user's:

> **`ramonda-check-ignore` is for a fault being fixed** — a bug of ours until it is fixed, or the app's own until it
> fixes it. It is never the way to a valid design. A design that is valid and refused is a design the framework must
> support, in a way that can be checked.

So each place this proposal could have refused a valid design either supports it, or shows the checkable way the
same need is met:

- **A table that depends on the app's state** (review B): supported by the condition rule — the link must sit under
  the same condition.
- **The same module under two addresses** (a blog at `/blog` and at `/news`) is NOT a feature, decided
  2026-11-13 after measuring it. A function of a prefix cannot be typed — computed keys widen the paths to
  `string`, measured — and a router helper (`mountAt(prefix, table)`) types the routes but breaks the links INSIDE
  the module: its post page links to its list, and with two prefixes that link cannot be written, so it would have
  to be relative and resolved at runtime, which neither the type nor `ramonda-check` can follow. It would trade
  the checked links this whole design exists for. Reuse is done where large apps do it, at the component level,
  with an explicit table:

  ```tsx
  createRoutes({
    "/blog": <PostList source="blog" />,
    "/blog/:slug": <Post source="blog" />,
    "/news": <PostList source="news" />,
    "/news/:slug": <Post source="news" />,
  });
  ```

  The components are shared; what differs — the data source, a title, a permission — arrives by props or a
  context. Every address is written, found by a search, and checked. A language or a tenant in the address needs
  none of this: `/:lang/tournaments` and `/org/:orgId/…` are paths with a param. A third-party package whose prefix
  the app chooses is the one real case left, and it carries the same link problem — a design of its own when such
  a package exists, not something added ahead of it.

What remains refused is what is never meant: a path two parts both name, a second `"*"`, and a route an earlier
pattern hides.

## Decided

1. **The app registers its assembled table** (`Routes { app: typeof routes }`); a module registers its slice only
   when it is lifted into a package. (2026-11-13)
2. **A path two parts both name, or a second `"*"`, is refused** by `createRoutes` when the table is built, naming the
   two parts — in every build, since the router has none for development alone; it is at module load, so the first
   dev server start or test run stops on it and it never ships. A duplicate is never meant, and the catch-all is the app's alone. (2026-11-13)

## Review — cases this design meets, 2026-11-13

**A. The server's per-route modes live in the app — DECIDED as recommended.** `defineServer(routes, { "/": { prerender:
true }, … })` types its config as EVERY path of the table (`ServerConfig<C>`, a mapped type with every key
required). With modules, the app's `entry-server.tsx` lists every module's paths and how each renders:

- a module adding a route cannot be done inside the module — the app's server file fails to compile until it
  names the new path (loud, which is good, but it is an edit across the boundary every time);
- whether a page is static is a fact about the page and its data, which the module owns — and at extraction the
  modes stay behind in the app;
- `PRERENDER_PATHS`, the concrete pages of a `:param` route, are the module's data too.

REVISED 2026-11-13, before it was built: **`defineServer` does not change.** Taking parts as arguments would
have collided with its third argument, the options (`{ defaultMode }`), and it is not needed: a server config is a
plain object keyed by path, not a compiled table, so a spread works here. A part's modes are written beside the
part, in a server-only file, typed by the part's own table, and spread into the app's config:

```ts
export const tournamentModes = {
  "/tournaments": { prerender: true },
  "/tournaments/:id": {},
} satisfies ServerConfig<typeof tournamentRoutes>;

defineServer(routes, { ...tournamentModes, "/": { prerender: true } });
```

Measured: the complete config is accepted; a path the spread does not bring is refused (TS2345); a mode for a path
the part does not have is refused by `satisfies` (TS2353). `ramonda-check` does not read server modes at all, so
the spread is no blind spot for it. The module owns its pages' modes, which was the point.

**B. A part under a condition the build cannot fold — REVISED 2026-11-13: supported, not refused.**
`features.admin ? adminRoutes : undefined`, a tenant's configuration read at startup, a flag: these are real
designs — an app for several customers that enables modules per customer, a plugin system. Refusing them would
leave a legitimate app one way out, `ramonda-check-ignore`, and an ignore is for a fault being fixed, never for a
valid design (see "What this narrows"). So the environment rule of section 3 is the general one: **a part under a
condition holds routes that exist only under that condition, and a link to one must be under the same condition**
— the same name, or the same expression — or inside that part's own pages. `import.meta.env.DEV` is one case of it.

**C. A later path an earlier part's pattern already matches — DECIDED as recommended.** `/tournaments/:id` in the
tournaments part and `/tournaments/new` in a part after it: the first match wins, so `/tournaments/new` can never
be reached. Within one literal table the same thing can happen today, but there the two lines sit together; across
files nobody sees it. Recommended: **refuse it beside the duplicates of decision 2** — a static path
an earlier pattern matches is unreachable, which is never meant.

**D. Lazy pages — guidance, no change.** A module whose `routes.tsx` imports its pages directly puts the whole
module in the first download, which defeats one reason to have modules. The table already takes
`<AsyncLoad lazy={…} />` as a view, and `ramonda-check --split` already reports what loads when. The module pages
of the docs should show a lazy table; a checker rule can come later, if apps do not follow it.

**E. An extracted module and two copies of the router — note for the extraction step.** The package's registration
augments the `@ramonda/router` IT resolves. If it carries its own copy, the augmentation and the contexts land on a
second router: the app's links stop seeing the package's slice, and the package's `Navigator` reads a context
nobody provides. `@ramonda/router` (and `@ramonda/core`) must be peer dependencies of an extracted module — the
extraction command writes them so, and `ramonda-check` can report a module package that bundles a router.

**F. Nested outlets — unchanged.** An inner outlet takes its own table, as today; the outer table already names
every path a page renders on (`/routing/nested`), so registering the outer one still covers every href.

## Open questions

None. Built in this order, each step gated by the full check:

1. **BUILT.** `createRoutes(...parts)` and `Routes { [name] }`, with the refusals (duplicate path, second `"*"`, a static
   path an earlier pattern shadows); templates, docs and apps move to `Routes { app }`.
2. **BUILT** (docs only, `/ssr/modes`). A part's modes as a spread object typed `ServerConfig<typeof part>` — no
   API change; see review A.
3. **BUILT.** `ramonda-check`: following a table's parts — names and both arms of a condition — then the condition
   rule (`link-to-a-conditional-route`). A part made by a call is not a feature (see "What this narrows").
4. The docs' module pages, with a lazy table.
