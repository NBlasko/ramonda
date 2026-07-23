---
title: Building a static site
description: The whole build is six lines — routePaths, renderPage, renderDocument.
section: Server rendering
order: 93
---

# Building a static site

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

That is the build. This site is produced by it.

## `routePaths` splits what it can enumerate from what it cannot

```ts
const { paths, needsData } = routePaths(routes, ["/players/1", "/players/2"]);
```

A route table is a set of **patterns**, and only some of them are pages. `/guide` is one page;
`/players/:id` is one route and however many players there are.

`needsData` is the list of patterns whose values live in your data. A build that enumerated the
table and stopped would ship a site missing everything dynamic — and nothing about the output
would look wrong, because the pages it *did* emit are all correct. So fail on it:

```ts
if (needsData.length && extra.length === 0) {
  throw new Error(`These routes need concrete paths: ${needsData.join(", ")}`);
}
```

`"*"` is excluded — it matches what matched nothing, so it has no URL. Render a 404 explicitly at
whatever path your host expects.

## `renderDocument`

Wraps a rendered page in a complete document: doctype, charset, viewport, title, the page's own
head, a root element, stylesheets, module scripts.

| option | |
|---|---|
| `lang` | `<html lang>`, default `"en"` |
| `scripts` | module scripts at the end of `<body>` — your hydration entry |
| `styles` | stylesheet hrefs |
| `headExtra` | raw markup for whatever this does not model. **Not escaped** |
| `rootId` | the element the app mounts into, default `"app"` |

Deliberately small. A shell is the one part every project wants slightly differently, so it models
what is the same everywhere and leaves the rest to `headExtra`.

`charset` is emitted **before** the title, on purpose: a browser not told the encoding guesses
from the first bytes and restarts the parse if it guessed wrong, and the spec asks for it inside
the first 1024 bytes — which a long non-ASCII title could push it past.

## One DOM, not one per page

A build loop is **sequential**, so it does not need a fresh DOM per page the way a concurrent
server does. Changing the URL between renders is enough; this site's build renders every page into
one document and the output is byte-for-byte repeatable across builds.

## Your bundler needs two builds

A client bundle (which calls `hydrateRoot`) and a server bundle for the build loop. **Node cannot
parse TC39 decorators**, so the build script has to run *transpiled* output — a dev server's
transform will not do.

If you use `AsyncLoad`, **split both bundles**. With `--outfile` and ESM, esbuild cannot make a
chunk, so it leaves `import("./Panel")` as a literal runtime import that then fails to resolve
from the build directory — and every lazy component renders its error fallback into your HTML.

## Next

- [Async work on the server](/ssr/async).
