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

## The build and the server

- **Build** (`routePlan(server)` gives the split): each static/ISR route is rendered with the
  request poisoned and written to a file. A route that reads the request fails the build.
- **Server**, per request: a static route serves its baked file; an ISR route serves the cache
  and refreshes it in the background when it is older than `revalidate`; a dynamic route renders
  fresh with the real request.

The scaffolded SSR app (`npm create ramonda`, choose SSR) wires all of this for you — a routed
app with the three modes and the build guard already set up.

## Hosting

- **static** files can be served from anywhere — a CDN, a static host, no server at all.
- **ISR** needs a running server to revalidate (a server-side cache, not pure CDN).
- **dynamic** needs a server that can render (Node today, since the render builds real DOM
  nodes).

Splitting a site this way lets you host the static majority anywhere and run a server only for
the routes that truly need the request.

## Next

- [Reading the request](/ssr/request) — `requestContext`, and the guard up close.
