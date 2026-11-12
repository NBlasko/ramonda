---
title: Deploying
description: The four steps of a build and why the last one exists, where each route can live, and what is decided at build time.
section: Across the app
order: 119
---

# Deploying

There is no deployment target to configure and no adapter to install. A Ramonda app builds to
files: static HTML and JavaScript for the parts that can be baked, and a Node process for the parts
that need the request.

What is worth reading before the first deploy is the shape of the build, why it ends with a check,
and the two things that are decided while the build runs rather than when the server starts.

## The build has five steps, and the order is the point

This is what `create-ramonda` writes for a server-rendered project:

```sh
ramonda-check && npm run typecheck && npm run build:bundles && node scripts/prerender.mjs && ramonda-check-bundle dist
```

A client-only project is the same shape with the bundle and the prerender as one:

```sh
ramonda-check && npm run typecheck && vite build && ramonda-check-bundle dist
```

**[`ramonda-check`](/reference/check) goes first because it is the cheap step.** It reads your
source and never runs the app, so it fails in seconds on a fault that would otherwise be found
after the bundle, the prerender and a deploy.

**`npm run typecheck` is second because nothing after it reads a type.** Vite and esbuild strip the
types and keep going, so without it a type error ships. It is `tsc --noEmit` until a file holds a
[style block](/style-blocks/setup#move-the-type-check), and `ramonda-css` from then on.

**[`ramonda-check-bundle`](/reference/check#the-bundle-that-did-not-parse) goes last because it is
the only step that can see the output.** Which is the next section, and it is the one thing on this
page that has actually broken a build here.

## Why the last step exists

`@state`, `@compute` and the rest are TC39 decorators, and **no browser engine parses them
today**. Your
bundler has to transform them away. Under esbuild, and so under Vite 7, that comes down to one
setting: below `esnext`, esbuild rewrites them into helpers; at `esnext` it leaves them exactly as
written. Vite 8 transforms with Oxc, which leaves them as written whatever it is told — there,
`ramonda()` from `@ramonda/build` lowers them itself.

**Nothing tells you when that goes wrong.** The build succeeds, prints no warning, and emits a file
that dies with `SyntaxError: Invalid or unexpected token` the moment a browser reads it. It happened
in this repository: the transform was being applied as a side effect of an unrelated option, and
removing that option broke the output in silence.

`ramonda-check-bundle dist` reads what was emitted and answers whether it parses. **Finding no
JavaScript at all is a failure rather than a pass**, because a build that silently emitted nothing
is the same shape of bug.

[`@ramonda/build`](/reference/build) sets the option correctly for both bundlers. This step is what
proves it still did.

## Where each route can live

A server-rendered project decides this per route, and the answer changes what you have to run. See
[rendering modes](/ssr/modes).

| | needs | |
|---|---|---|
| **static** | nothing | files on a CDN or any static host |
| **ISR** | a running server | it rebakes in the background, so a pure CDN cannot do it |
| **dynamic** | a running server | it renders per request |

**The split is the point.** Host the static majority anywhere and run a server only for the routes
that truly need the request.

**A dynamic or ISR server means Node today**, because the render builds real DOM nodes —
[`@ramonda/server`](/ssr/server) installs a DOM around it. A worker runtime with no DOM
implementation cannot host that half.

**And the ISR store has to match how many instances you run.** `memoryStore()` keeps pages in one
process, so two instances behind a load balancer serve two different caches; `fileStore({ dir })`
needs a volume they share. See [choosing a store](/ssr/modes#choosing-a-store-isrstore).

## Every route static: one folder for a static host

When every route is baked at build, no server is needed, and a project from `create-ramonda` makes the
whole site one folder:

```sh
npm run build:static
```

`dist/site` then holds every page as `about/index.html`, the scripts, everything from `public/`, and
`404.html` — the app's own `"*"` page, which a static host serves for a path it has no file for. Upload
that folder. A page is a folder's `index.html`, which static hosts serve at `/about`; most redirect
`/about/` to `/about` or the other way, and the router reads both as the same route.

A route that is not baked — one that renders per request, or an ISR one — needs `npm start` running, so
`build:static` refuses and names it rather than uploading a site that serves it as a missing page. A
`:param` route marked `prerender` is baked from the paths in `PRERENDER_PATHS`, in
`src/entry-server.tsx` — the one list the build and the server both read. An id only the reader's
browser has goes in the query instead, on one baked route: see
[a path and a query, or a `:param`](/routing/links).

## Your site's own address

A canonical link, `og:url` and a sitemap all need the site's absolute address, and a baked page cannot
take it from `location`: the build renders at the prerender script's own `http://localhost:5173`. Say
it once, in a variable the build reads:

```sh
RAMONDA_PUBLIC_SITE_URL=https://turniri.example npm run build:static
```

Read it in one module, and give each page its canonical link through `Head`:

```ts
// src/site.ts
export const SITE = import.meta.env.RAMONDA_PUBLIC_SITE_URL ?? "";
```

```tsx
import { Component, Head } from "@ramonda/core";
import { Navigator } from "@ramonda/router";
import { SITE } from "./site";

class Page extends Component {
  route = this.use(Navigator);
  head = this.use(Head, () => ({
    link: SITE ? [{ rel: "canonical", href: SITE + this.route.pathname }] : [],
  }));
  render() {
    return <main>…</main>;
  }
}
```

The same variable gives `scripts/prerender.mjs` what a sitemap needs: it already has every baked path
from `staticPaths()`, so after the loop it can write `dist/static/sitemap.xml` from them, and a
`robots.txt` whose `Sitemap:` line names it. Write both only when the variable is set — a sitemap of
`localhost` addresses is worse than none — and the script empties `dist/static` before each build, so
one from an earlier build never ships.

## What is decided at build time

Two things, and both surprise people once.

**A public environment variable is baked in.** `import.meta.env.RAMONDA_PUBLIC_…` is compiled into
the bundle **as a literal**, so it is the value that was present when the build ran. Changing it in
your host's dashboard changes nothing until you build again. A value that must vary per deploy
without a rebuild has to arrive another way — from the server, through
[the request](/ssr/request), or from an endpoint the page calls.

`process.env` is the opposite: it is read when the server runs, so it follows the environment it was
started in. See [environment variables](/reference/build#environment-variables).

**A prerendered page is frozen at the moment it was built**, including anything it fetched. That is
what makes it free to serve, and it is why a route that reads the request
[cannot be prerendered at all](/ssr/modes#the-build-refuses-to-bake-a-per-request-page-renderstatic-and-staticrender) — the build
refuses rather than baking one visitor's data for everyone.

## Next

- [Rendering modes](/ssr/modes) — choosing per route, and what a `:param` route needs before it can
  be baked.
- [Configuring your build](/reference/build) — the bundler settings, and the environment split.
- [Checking your app](/reference/check) — both commands, and everything the first one reads.
