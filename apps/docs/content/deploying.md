---
title: Deploying
description: The four steps of a build and why the last one exists, where each route can live, and what is decided at build time.
section: Across the app
order: 108
---

# Deploying

There is no deployment target to configure and no adapter to install. A Ramonda app builds to
files: static HTML and JavaScript for the parts that can be baked, and a Node process for the parts
that need the request.

What is worth reading before the first deploy is the shape of the build, why it ends with a check,
and the two things that are decided while it runs rather than when it starts.

## The build has four steps, and the order is the point

This is what `create-ramonda` writes for a server-rendered project:

```sh
ramonda-check && npm run build:bundles && node scripts/prerender.mjs && ramonda-check-bundle dist
```

A client-only project is the same shape with the middle two collapsed:

```sh
ramonda-check && vite build && ramonda-check-bundle dist
```

**[`ramonda-check`](/reference/check) goes first because it is the cheap step.** It reads your
source and never runs the app, so it fails in seconds on a fault that would otherwise be found
after the bundle, the prerender and a deploy.

**[`ramonda-check-bundle`](/reference/check#the-bundle-that-did-not-parse) goes last because it is
the only step that can see the output.** Which is the next section, and it is the one thing on this
page that has actually broken a build here.

## Why the last step exists

`@state`, `@compute` and the rest are TC39 decorators, and **no engine can parse them**. Your
bundler has to transform them away, and whether it does comes down to one setting: below `esnext`,
esbuild rewrites them into helpers; at `esnext` it leaves them exactly as written.

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
