---
"@ramonda/core": minor
---

Add `requestContext()` — per-request data with a build-time safety guard.

Per-request data (cookies, headers, the signed-in user) is now reachable only through
`requestContext()`, so a static build can PROVE a route touched none of it before baking:

- `requestContext().url` is always safe (it is the page identity).
- `requestContext().cookies` / `.headers` / `.get(key)` return real values on the server and
  the exposed subset on the client, but **throw during a static build** (`RequestReadDuringBuild`).
  A page that reads the request literally cannot be prerendered, so one user's data can never
  end up in another's cached HTML.
- `requestKey<T>(label)` declares a typed per-request slot; `seedRequest(key, value)` fills it
  on the server before the render; the tree reads it with `requestContext().get(key)`.

This is the safety core for the upcoming per-route SSG/SSR/ISR work (default SSR, opt-in
prerender guarded by this poison). New exports: `requestContext`, `requestKey`, `seedRequest`,
`RequestReadDuringBuild`, and the `RequestContext` / `RequestKey` / `RequestCookies` /
`RequestMode` types.
