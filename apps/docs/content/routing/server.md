---
title: The router on the server
description: How routing works during a server render, and why the browser's URL wins on hydration.
section: Routing
order: 75
---

# The router on the server

The router works during [server rendering](/ssr) with no special API — what changes
is only which lifecycle runs.

## The URL comes from the request

`Router` reads `window.location` at startup, so the server points its DOM at the
request URL before rendering. A static build does the same, with `pushState` between
pages:

```ts
for (const path of paths) {
  window.history.pushState(null, "", path);
  const page = await renderPage(<App />);
  write(path, renderDocument(page));
}
```

There is no server-only router API — the same code renders on both sides.

## The browser's URL wins on hydration

The route the server rendered travels to the browser in the hydration data, and then
the router re-reads the actual URL as it starts up. That last step matters: if the
browser is at a *different* URL than the server rendered — a cached page, a CDN
serving one file for many paths, a redirect between request and hydration — re-reading
is what makes it show the right page instead of the server's.

## What doesn't run on the server

- The `popstate` listener (it's an effect, and effects are client-only — there is no
  history to react to on the server).
- Client-only setup like the single-`Router` check, keyed to
  `@create({ env: "client" })`.

See [client / server / shared](/ssr/env) for how lifecycle picks a side.

## Static builds

`routePaths(routes)` gives you the concrete paths to render, and flags any pattern it
cannot list out. See [building a static site](/ssr/static).

## Next

- [Why prerender](/ssr) — and what it buys.
