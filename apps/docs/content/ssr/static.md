---
title: Building a static site
description: Render every page to an HTML file at build time — the whole loop is a few lines.
section: Server rendering
order: 93
---

# Building a static site

A static build renders every page to an HTML file at build time. The whole loop is a
few lines:

```ts
import { renderPage, renderDocument } from "@ramonda/core";
import { routePaths } from "@ramonda/router";

const { paths, needsData } = routePaths(routes);

for (const path of paths) {
  window.history.pushState(null, "", path);
  const page = await renderPage(<App />);
  write(path, renderDocument(page, { scripts: ["/assets/client.js"] }));
}
```

This site is built exactly like that.

## `routePaths` — the pages it can list, and the ones it can't

A route table is a set of *patterns*, and only some are single pages. `/guide` is one
page; `/players/:id` is one route but as many pages as there are players.

```ts
const { paths, needsData } = routePaths(routes, ["/players/1", "/players/2"]);
```

`needsData` is the list of patterns whose values live in your data — you supply the
concrete paths (the second argument). A build that ignored `needsData` would silently
ship a site missing everything dynamic, so it is worth failing on:

```ts
if (needsData.length && extra.length === 0) {
  throw new Error(`These routes need concrete paths: ${needsData.join(", ")}`);
}
```

(`"*"` is left out — it matches what nothing else did, so it has no URL. Render a 404
page explicitly at whatever path your host serves for missing files.)

## `renderDocument`

Wraps a rendered page in a complete HTML document — doctype, charset, viewport, title,
the page's own head, a root element, your stylesheets and scripts.

| option | |
|---|---|
| `lang` | `<html lang>`, default `"en"` |
| `scripts` | module scripts at the end of `<body>` — your hydration entry |
| `styles` | stylesheet links |
| `headExtra` | raw markup for anything it doesn't model (favicon, analytics). **Not escaped** |
| `rootId` | the element the app mounts into, default `"app"` |

It is deliberately small: the document shell is the one part every project wants
slightly differently, so it does the parts that are always the same and leaves the
rest to `headExtra`.

## Your bundler needs two builds

A **client** bundle (which calls `hydrateRoot`) and a **server** bundle for the build
loop. Node can't parse TC39 decorators, so the build script runs *transpiled* output —
a dev server's on-the-fly transform won't do. (And if you use `AsyncLoad`, split both
bundles — see [lazy loading](/composition/lazy).)

## Next

- [Async work on the server](/ssr/async).
