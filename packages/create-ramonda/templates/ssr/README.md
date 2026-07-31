# Ramonda app (SSR)

A [Ramonda](https://ramonda.pages.dev) app that renders on the server and
hydrates in the browser. Dev is a Vite server with hot reload; production is an
esbuild bundle served by a small Node server.

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

## How it works

- `src/entry-server.tsx` — `renderToString(<App />)` turns the app into HTML.
- `server.mjs` — a Node server that installs a DOM per request (Ramonda's render
  builds real elements), calls `render()`, and drops the result into
  `index.html`.
- `src/entry-client.tsx` — `hydrateRoot` adopts the server's markup in the
  browser and wires up the behaviour, instead of re-rendering from scratch.
- `src/App.tsx` — your component. It must render the same thing on the server and
  the client, so keep `Date.now()` / `Math.random()` out of `render()`.

`npm run dev` runs Ramonda in **development** mode — you get the diagnostics and
the dev inspector. `npm run build` uses Ramonda's **production** build for a clean,
stripped-down server render.

## Learn Ramonda

Docs: **https://ramonda.pages.dev**
