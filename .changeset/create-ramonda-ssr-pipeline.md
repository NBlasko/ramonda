---
"create-ramonda": minor
---

The SSR template is now a routed app with per-route rendering modes — SSG, ISR, and dynamic.

Scaffolding an SSR project gives you a small routed app (`createRoutes` + `createRouter`, so
`<Link href>` is type-checked against your routes) whose `entry-server.tsx` declares how each
route renders:

```ts
defineServer(routes, {
  "/":            { prerender: true },   // static — baked at build
  "/about":       { revalidate: 60 },    // ISR — cached, rebaked every 60s
  "/hello/:name": {},                    // dynamic — rendered per request
});
```

`npm run build` bakes the static routes to `dist/static/` (failing loudly if a route marked
`prerender` reads the request — a baked page must never contain per-request data), and
`server.mjs` in production serves each request by its mode: static file, ISR (cached +
stale-while-revalidate), or a per-request `renderToString({ request })`. Dev is unchanged
(Vite, hot reload, everything rendered fresh).

`@ramonda/router` is now always included for SSR (the pipeline is built on it), add-on chosen
or not. Because the template uses new `@ramonda/core` (`renderStatic`, `requestContext`,
`renderToString({ request })`) and `@ramonda/router` (`createRouter`, `@ramonda/router/server`),
this release must ship core + router + create-ramonda together.
