# Ramonda app (SSR)

A [Ramonda](https://ramonda.pages.dev) routed app that renders on the server and
hydrates in the browser. Dev is a Vite server with hot reload; production is an
esbuild bundle served by a small Node server that renders **each route by its own
mode** — static, ISR, or per request.

## Develop

```bash
npm run dev     # Vite dev server on http://localhost:5173 — hot reload, no build step
```

Edit a component and the change is live: the browser hot-updates the client, and
the server picks up the new code on the next request — no restart.

## Production

```bash
npm run build   # bundle client + server into dist/ with esbuild
npm start       # serve the built output on http://localhost:5173
```

## How rendering modes work

`src/App.tsx` is a routed app (`createRoutes` + `createRouter`, so `<Link href>` is
type-checked against your routes). `src/entry-server.tsx` says **how each route
renders**, and the build refuses to bake anything unsafe:

```ts
defineServer(routes, {
  "/":            { prerender: true },   // static — baked to a file at build time
  "/about":       { revalidate: 60 },    // ISR — cached, rebaked every 60s
  "/hello/:name": {},                    // dynamic — rendered per request
});
```

- **static** pages are written to `dist/static/` by `npm run build` and served as files.
- **ISR** pages are cached and refreshed in the background when stale.
- **dynamic** pages render on each request via `renderToString({ request })`.

A route can read per-request data (cookies, headers, a signed-in user) with
`requestContext()`. If a route marked `prerender` reads the request, the **build fails
loudly** — a baked page must never contain one visitor's data. So per-user pages simply
aren't prerendered; the guard enforces it for you.

`server-only` config lives in `entry-server.tsx` (imported through `@ramonda/router/server`,
which never reaches the client bundle). The other files:

- `src/entry-client.tsx` — `hydrateRoot` adopts the server's markup and wires up behaviour.
- `server.mjs` — dispatches each request to the right mode (static file / ISR / dynamic).
- `scripts/prerender.mjs` — the build step that bakes the static routes.

`npm run dev` runs Ramonda in **development** mode (diagnostics + dev inspector, everything
rendered fresh with hot reload). `npm run build` uses the **production** build and bakes the
static routes.

## Learn Ramonda

Docs: **https://ramonda.pages.dev**
