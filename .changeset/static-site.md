---
"create-ramonda": minor
---

An SSR project can be deployed to a host that only serves files. `npm run build:static` writes the whole site as one folder, `dist/site` — the baked pages, the scripts, `public/`, and `404.html`, which the build now bakes from the `"*"` route — and refuses, by name, a route that renders per request or on a timer. `src/entry-server.tsx` keeps the paths of a static `:param` route in one list, `PRERENDER_PATHS`, read by both the build and the server: asked with none, a `:param` route marked `prerender` stopped the production server as it started.
