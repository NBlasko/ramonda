---
title: Rendering modes
description: Render each route the way it needs — baked at build (static), per request (dynamic), or cached and refreshed (ISR).
section: Server rendering
order: 83.5
---

# Rendering modes

Not every page wants the same treatment. A marketing page is the same for everyone, so it
should be **baked once** and served as a file. An account page depends on who is asking, so it
must render **per request**. A page that changes slowly can be **cached and refreshed on a
timer**. Ramonda lets you choose per route — and refuses to bake anything that would leak one
visitor's data to another.

Three modes:

| mode | when it renders | for |
|---|---|---|
| **static** | at build | pages that are the same for everyone |
| **dynamic** | per request | pages that depend on the request (a signed-in user, a cookie) |
| **ISR** | at build, then re-baked on a timer | pages that change slowly and have no per-user data |

## Two files: the route table, and how it renders

The setup is split in two on purpose — so server-only code never reaches the browser.

**The route table** is shared by the client and the server. It is just paths and what to show:

```tsx
// src/routes.tsx  (client + server)
export const routes = createRoutes({
  "/": <Home />,
  "/about": <About />,
  "/account": <Account />,
  "*": <NotFound />,
});
export const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);
```

**The rendering config** is server-only. It says how each route renders, and it lives in a
`server/` folder so nothing in it can end up in the client bundle:

```tsx
// server/routes.ts  (SERVER ONLY)
import { defineServer } from "@ramonda/router/server";
import { routes } from "../src/routes";

export const server = defineServer(routes, {
  "/":        { prerender: true },   // static
  "/about":   { revalidate: 60 },    // ISR — re-baked every 60s
  "/account": {},                    // dynamic (the default)
});
```

`@ramonda/router/server` is a separate entry that **cannot be imported from client code** — a
browser build that tries fails, so your loaders, secrets and database calls stay on the server.
Keep everything under `server/`.

## The two files can't drift

`defineServer`'s config is **exhaustive**: every route in the table must have an entry. That is
the safety net for a team — add a route and the config stops type-checking until you say how it
renders, and an entry for a route that doesn't exist is a type error too.

```tsx
defineServer(routes, {
  "/": { prerender: true },
  // ✗ type error: "/about" and "/account" are missing
});

defineServer(routes, {
  "/": {}, "/about": {}, "/account": {},
  "/typo": {},   // ✗ type error: "/typo" is not a route
});
```

So the route table is the single source of truth, and both `createRouter` (which types your
`<Link href>`) and `defineServer` (which types this config) are checked against it. You never
maintain two lists by hand. (The `"*"` fallback is not a real destination, so it needs no entry.)

## Default is dynamic

A route with no entry — a bare `{}` — renders **per request**. That is the safe default: the
worst case is "slower", never "one user's page served to another". You opt a route *into*
baking with `prerender: true`; you never have to remember to opt out.

A project that is static by nature (a docs site) can flip the default:

```tsx
defineServer(routes, { /* … */ }, { defaultMode: "static" });
```

Now unmarked routes are baked, and you mark the few dynamic ones with `prerender: false`.

## The build refuses to bake a per-request page

This is the rule the whole design protects: **a baked page must never contain per-request
data.** You don't have to audit every component to be sure — the build proves it. When it
prerenders a route, the request is *poisoned*: any read of a cookie, a header, or a per-request
value (see [reading the request](/ssr/request)) throws, and the build fails, naming the route
and what it read:

```
✗ /account — reads the request (cookies.get("session")); cannot be prerendered.
```

So a page that reads the request simply can't be marked `prerender` — the guard enforces it.
Mark it dynamic (the default) and it renders per request instead.

## A route with a `:param` — the build has to be told which pages exist

A route table is a set of PATTERNS, and only some of them are pages. `/guide/state` is one page;
`/guide/:slug` is one route and however many guides there are. So a parameterised route marked
`prerender` needs its paths, and they come from your data:

```ts
import { routePlan } from "@ramonda/router/server";

const GUIDES = ["state", "effects"];

const staticPaths = (): string[] => routePlan(server, GUIDES.map((slug) => `/guide/${slug}`)).static;
// → ["/", "/guide/state", "/guide/effects", "/signup"]
```

`plan.static` holds **paths**, never patterns. `plan.needsData` names the parameterised routes the
paths were for, so a build can report what it was asked to bake.

**Marked `prerender` with nothing supplied, the build stops:**

```
[Ramonda] `/guide/:slug` is marked for prerender and takes :slug, so a build cannot know which
pages exist. Pass them: routePlan(server, items.map((item) => `/guide/${item.slug}`)).
Or drop `prerender` and let it render per request.
```

It stops rather than skipping the route, for the same reason a per-request read stops it: a config
that says `prerender` and a build that quietly does not is how a site ships missing half its pages
while every page it did emit looks perfectly correct.

**A `revalidate` route with a `:param` needs no paths, and that is the difference.** Nothing is baked
at build; the cache fills as pages are asked for, and each one is a page of its own — `/products/7`
and `/products/9` are cached separately under the one route. So the build is told nothing, and
`plan.needsData` names such a route only for a build that wants to warm some of them itself.

What it does need is a **limit**, because one route is now as many pages as there are items:

```ts
import { createIsrCache, fileStore, routePlan } from "@ramonda/router/server";

const isr = createIsrCache({
  plan: routePlan(server),
  store: fileStore({ dir: "dist/isr" }),
  render: bakePath,
  maxPages: 500, // required when an ISR route takes a `:param`
});
```

`createIsrCache` refuses to start without it for those routes, and refuses it when no route has a
param — a number that bounds nothing is a number somebody will trust. Past the limit the page nobody
has asked for longest is dropped.

**Least recently asked for, not fewest hits**, and the intuitive rule is the wrong one here: hit counts
accumulate, so a product that was popular last week keeps its ten thousand while one that went viral an
hour ago has three — and a brand new page always has the fewest, so it would always be the first thrown
out. Recency adapts by itself. The count is per process, so two instances over one directory each bound
their own view.

## The build and the server

- **Build** (`routePlan(server, paths)` gives the split): each static/ISR route is rendered with
  the request poisoned and written to a file. A route that reads the request fails the build.
- **Server**, per request: a static route serves its baked file; an ISR route serves the cache
  and refreshes it in the background when it is older than `revalidate`; a dynamic route renders
  fresh with the real request.

The scaffolded SSR app (`npm create ramonda`, choose SSR) wires all of this for you — a routed
app with the three modes and the build guard already set up.

## Where ISR pages are kept

An ISR page is baked once and served to everyone until it is rebaked, so **where you keep it
decides whether two visitors see the same thing**. `createIsrCache` owns the timing; you hand it
a store:

```ts
import { createIsrCache, fileStore, routePlan } from "@ramonda/router/server";

const isr = createIsrCache({
  plan: routePlan(server),
  store: fileStore({ dir: "dist/isr" }),
  render: bakePath, // your shared render — the same one the build uses
});
```

The server then asks it for every request:

```js
// `undefined` means "not an ISR route" — fall through to static or dynamic.
const page = await isr.serve(path);
if (page) return sendHtml(res, page.html, page.mode);
```

`page.mode` is `isr-hit` (fresh), `isr-stale` (the old copy, with a rebake already running behind
it), or `isr-cold` (nothing cached, so this request waited for the render).

### Choosing a store

| | keeps pages | use it when |
|---|---|---|
| `memoryStore()` | in this process | one instance, or local development |
| `fileStore({ dir })` | in a directory | a restart must not empty the cache, or instances share a volume |
| your own | wherever you like | instances share nothing but a Redis or a database |

A store is three small methods, which is the whole point:

```ts
const redisStore = {
  async get(key) {
    const raw = await redis.get(`isr:${key}`);
    return raw ? JSON.parse(raw) : undefined;
  },
  async set(key, entry) {
    await redis.set(`isr:${key}`, JSON.stringify(entry));
  },
  async delete(key) {
    await redis.del(`isr:${key}`);
  },
};
```

**`delete` is not optional.** A route with a `:param` fills the cache as pages are asked for, so
`maxPages` has to be able to drop one — a store without it fails at the first eviction, and that
failure is reported rather than raised, so the cache would grow instead of stopping.

A store may lose an entry at any time — eviction, expiry, a cleared directory. That is not an
error: a missing entry is a cold render, which is always correct and only slower.

### What the cache promises, and what it does not

- **One rebake at a time, per instance.** Ten requests arriving while a stale page is rebaking
  start one render, not ten. Across instances each rebakes at most once per window, so two can
  still bake the same page at the same moment — wasted work, never a wrong answer.
- **A failed background rebake keeps serving the stale page.** An old page is a smaller problem
  than no page. A failed *cold* render throws, because there is nothing else to send.
- **A deploy must clear the cache.** Pages in it were rendered by the bundle you just replaced,
  so serving one afterwards hands the browser old markup for a new client bundle. The scaffolded
  app clears `dist/isr` in its prerender step, which runs on every build.

## Hosting

- **static** files can be served from anywhere — a CDN, a static host, no server at all.
- **ISR** needs a running server to revalidate (a server-side cache, not pure CDN).
- **dynamic** needs a server that can render (Node today, since the render builds real DOM
  nodes).

Splitting a site this way lets you host the static majority anywhere and run a server only for
the routes that truly need the request.

## Next

- [Reading the request](/ssr/request) — `requestContext`, and the guard up close.
