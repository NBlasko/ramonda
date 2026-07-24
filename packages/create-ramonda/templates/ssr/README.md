# Ramonda app (SSR)

A [Ramonda](https://ramonda.pages.dev) app that renders on the server and
hydrates in the browser. Built with esbuild and served by a small Node server.

## Develop

```bash
npm run build   # build the client and server bundles into dist/
npm start       # run the server on http://localhost:5173
npm run dev     # build, then start
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

The bundles are built against Ramonda's **production** build for a clean server
render. For the dev inspector and diagnostics, the SPA template (`create-ramonda`
→ SPA) runs Ramonda in development mode.

## Learn Ramonda

Docs: **https://ramonda.pages.dev**
