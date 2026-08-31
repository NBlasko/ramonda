# @ramonda/server

## 0.2.2

### Patch Changes

- ccc64fe: Every package's npm page carries the same four facts, and `homepage` points at its own docs

  The README is published, so this is a change to what a reader lands on. Measured before it was
  written: of eleven published packages, five carried no licence, three named no install command
  anywhere, one had no badges, and two linked to no documentation at all. `create-ramonda` and
  `@ramonda/devtools` had no README whatsoever — their npm pages were blank.

  Those facts are now generated from the sources that already held them — the package name, its
  `peerDependencies` (required ones appear in the install line; `bguard` is declared optional and
  so does not), and `homepage`, which now points at the package's own documentation section rather
  than at the site root. npm shows `homepage` beside the package, so that is a better npm page on
  its own as well as the one source the README link is written from.

  Nothing below the generated region changed. Each README keeps its own voice, and its own headings.

## 0.2.1

### Patch Changes

- 5632f32: The documentation is at **ramonda.dev**, and everything that names it says so.

  The site was reachable only at its Cloudflare Pages subdomain, `ramonda.pages.dev`, and that address was
  written into 63 places. The custom domain is attached now, so all of them name it: `homepage` in every
  published `package.json`, every README, the URL a diagnostic tells you to open, the scaffolder's closing
  line, both `create-ramonda` templates, and `BASE` in `apps/docs/src/entry-server.tsx`.

  **`BASE` is the one that mattered beyond tidiness.** Every `canonical`, `og:url`, `og:image` and the
  whole of `sitemap.xml` and `robots.txt` are built from it — its own docblock warned that a move would
  take the canonical tags and leave the sitemap behind. Left alone, every page on the new domain would
  have told a search engine that the real page is on `pages.dev`. Verified on a real build rather than
  assumed: `Sitemap: https://ramonda.dev/sitemap.xml`, `<loc>https://ramonda.dev/…`, and the canonical
  and `og:image` tags on the built pages.

  **Two places deliberately keep the old host.** The CHANGELOGs: those are published release notes, the
  links were correct when they were written, `pages.dev` still resolves, and rewriting them would be
  rewriting history. And `.github/workflows/README.md`, where `ramonda.pages.dev` is a FACT about
  Cloudflare — the project's name is its subdomain — so the sentence stays and gains the one that was
  missing: the site is served at the custom domain, and leaving anything on `pages.dev` is how a search
  engine is told the real page is elsewhere.

## 0.2.0

### Minor Changes

- ccb7629: A prerendered page keeps its named portal targets, and a hand-assembled shell can place them.

  `Portal`'s plan was that a portalled subtree should be indistinguishable from a normally mounted
  one — full SSR into any named target, state restored on hydration, `list()` working inside it.
  Every part of that had unit tests and **not one application used it**, in this repository or in the
  docs site. Rendering one through a real build found two holes, both silent:

  **`renderStatic` dropped `portals`.** `renderPage` returns them; the build-time render that bakes a
  static page did not, and did not reset its containers before rendering either. A prerendered page
  therefore lost every named portal block — the file looked correct, and the client built the subtree
  a SECOND time on hydration because there was no container to adopt. Only a real static build could
  show it.

  **A hand-assembled shell had nowhere to put them.** `renderDocument` emits a container per target,
  but an app that writes its own shell — which the SSR template and this repository's playground both
  do — had no supported way to. `fillDocument` now takes `portals` and fills a `<!--portals-->` marker:

  ```js
  res.end(fillDocument({ template, html, title, head, portals }));
  ```

  ```html
  <div id="app"><!--ssr--></div>
  <!--portals-->
  ```

  A shell with blocks to place and no marker **throws**, naming the targets. That is the one missing
  marker not returned quietly: a missing `<!--ssr-->` gives a page with no app in it, which announces
  itself, while a dropped portal gives a page that looks perfect and then duplicates a modal in the
  browser.

  The markup matches `renderDocument` exactly — same attribute, same escaping, same position after
  the app root — because the two disagreeing is itself a way to make hydration rebuild.

  **A scaffolded SSR project ships the head it renders, and has somewhere to put a portal.**

  It rendered with `renderToString`, which hands back the body and nothing else — no title, no meta,
  no portal blocks. A generated project that added a `<Head>` therefore shipped pages with **no title
  and no description**, invisible to exactly the crawlers server rendering exists for. Measured on a
  scaffolded project, not inferred. It now renders with `renderPage`, and the shell carries
  `<!--head-->` and `<!--portals-->`.

  The portals marker is there before anything uses one, on purpose: `fillDocument` refuses a render
  that collected blocks with no marker, so without it the first `<Portal target={portalTarget(…)}>`
  someone writes breaks their build, and the fix is one line in a file they had no reason to open.

  Its ISR entries now cache the **whole document** rather than the body. Filling the shell at send
  time works until the shell changes under a cached page — and with a head collected per page, the
  head is what goes stale first: one page's cached entry served with another's title.

  `fillDocument` also stops taking an EMPTY title literally. `renderPage` returns `""` when no `Head`
  set one, which is a report of absence; writing it emptied the shell's own `<title>`, and a
  scaffolded project shipped `<title></title>`. Found by building one.

  **A finished `renderPage` no longer leaves a page's portal containers standing.** It resets the head
  in its `finally` for a stated reason — keeping a long-lived server from carrying one request's tags
  into the next — and portals were missing it, though they hold whole DOM subtrees rather than a few
  tags. Measured: a container still held the last page's markup after the call returned, while
  `renderStatic` cleared both.

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
