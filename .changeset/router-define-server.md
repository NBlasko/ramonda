---
"@ramonda/router": minor
---

Add `@ramonda/router/server` — server-only per-route render config (`defineServer` + `routePlan`).

`defineServer(routes, config, options?)` attaches a rendering mode to each route in the shared
table, keyed by path. The config is **exhaustive**: every navigable path must have an entry, so
adding a route to `createRoutes` fails type-checking until it is handled here, and an entry for a
non-route is a type error too — the table and its server config cannot drift.

```ts
// app/server/routes.ts  (SERVER ONLY)
import { routes } from "../src/routes";
import { defineServer } from "@ramonda/router/server";

export const server = defineServer(routes, {
  "/":        {},                    // server (default)
  "/docs":    { prerender: true },   // SSG
  "/pricing": { revalidate: 60 },    // ISR
  "/u/:id":   { prerender: true },   // static per page (needs concrete paths to bake)
});
```

`routePlan(server)` partitions the table into `{ static, isr, server, needsData }` for the build.
`options.defaultMode` (`"server"` default, or `"static"`) sets what an unmarked route does.

Server-only by construction: it is a separate subpath (`@ramonda/router/server`) whose `browser`
export condition resolves to a stub that throws, and `defineServer` throws at runtime in a browser
too — so loaders, secrets, and DB access can never reach the client bundle. Keep it under a
`server/` folder in your app.

(The build-time guard that renders each opted-in route with the request context poisoned — proving
a baked route reads no per-request data — builds on this and lands next.)
