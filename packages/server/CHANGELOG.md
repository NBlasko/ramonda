# @ramonda/server

## 0.1.0

### Minor Changes

- 01c1f3a: New package: `@ramonda/server` — the plumbing a server render needs, so an app stops writing it.

  A DOM to render into, and the document the render goes into. Routing stays where it is: the route
  plan, the ISR cache and the render modes are `@ramonda/router/server`, and this package knows
  nothing about routes.

  ```js
  import { fillDocument, installDom, parseCookies } from "@ramonda/server";

  const dom = installDom(`http://localhost:5173${req.url}`);
  try {
    const { html, title, head } = await render({
      cookies: parseCookies(req.headers.cookie),
    });
    res.end(fillDocument({ template, html, title, head }));
  } finally {
    dom.close();
  }
  ```

  **It exists because the copies drifted, and one of them shipped.** Three separate faults, all the
  same shape:

  1. A project's `server.mjs` and its `scripts/prerender.mjs` each had a DOM installer. The server was
     moved from jsdom to linkedom; the prerender step was not. The build bundled successfully and then
     died at prerender with `ERR_MODULE_NOT_FOUND`.
  2. An unescaped `<title>` and a `$`-sequence corruption were found and fixed in ONE copy of the
     shell fill. **The scaffolded template shipped both until now:** `String.prototype.replace` reads
     `$&`, `` $` `` and `$$` in the replacement as patterns, so a page rendering "Save $$ today" put
     the marker back into its own output and still answered 200.

  A scaffolded SSR project now depends on `@ramonda/server` and carries no `installDom.mjs` of its
  own, so the next fix to any of this reaches projects that already exist.

  `linkedom` is a DEPENDENCY, not a peer, so a project that installs this names no DOM library at
  all. It was a peer for one afternoon, and the scaffolder put linkedom in `devDependencies` — which
  made `npm ci --omit=dev` produce a project that built and then died on `ERR_MODULE_NOT_FOUND`, the
  very fault being extracted. A peer is right when the consumer must choose the copy; nothing here is
  shared, and `installWindow` is already the seam for bringing your own.

  **`installWindow(url, window, { navigation })`** is the seam for a DOM you built yourself — a jsdom,
  to measure one implementation against the other, or to prerender a whole site on one document.
  `navigation: "dom"` takes that DOM's own `location`/`history`, so `pushState` between pages moves
  the URL; the default builds both from `url`, which is what a server answering one request wants.

  It is an argument rather than something detected, and that is measured rather than preferred:
  linkedom's window falls through to `globalThis` for anything it does not define, so the window built
  for the SECOND request reports the first request's location as its own — to `hasOwnProperty` as
  well. A "use the DOM's if it has one" rule reads as true from request two onward and serves every
  visitor the first URL's page.
