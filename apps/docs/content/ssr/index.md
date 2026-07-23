---
title: Why prerender
description: What a crawler sees, and why it decides how a framework should render.
section: Server rendering
order: 90
---

# Why prerender

A client-only app ships an empty shell and fills it in with JavaScript. A prerendered app ships
the finished HTML and *then* attaches behaviour to it.

| | what a crawler receives |
|---|---|
| client-only SPA | an empty `<div id="app">` |
| **prerendered** | the whole page, as text |

## This is mostly a distribution question

Nobody browses documentation from the homepage. They search, or they follow a link. If the served
HTML is empty, the page competes on nothing.

Google does eventually execute JavaScript, but indexing is delayed and unreliable. **Most other
crawlers do not run it at all** — and that now includes the ones feeding AI assistants, which is
increasingly how people ask about a library before they ever visit its site.

## And a load-time one

Prerendered content paints as soon as the HTML arrives. There is no "download the bundle, parse
it, run it, then see something" step in front of the first render — that work still happens, but
it happens *behind* content the reader can already use.

## What Ramonda gives you

| | |
|---|---|
| [`renderToString`](/ssr/render) | an app → HTML, with state blobs for hydration |
| [`renderPage`](/ssr/head) | the same, plus the `<head>` its components produced |
| [`renderDocument`](/ssr/static) | wraps that in a complete document |
| [`hydrateRoot`](/ssr/render) | adopts the server's DOM instead of rebuilding it |
| [`routePaths`](/ssr/static) | the paths a static build should render |

There is no separate server renderer to learn. The same components, the same lifecycle, the same
diff — the `env` option decides what runs where.

## SSR or SSG?

Both use the same functions. The difference is when you call them.

- **Static (SSG)** — call them at build time, write files, serve them from a CDN. No server, no
  runtime cost, and it is what this site does.
- **Server (SSR)** — call them per request, when the page depends on who is asking.

Start static. Move a route to per-request rendering when it genuinely cannot be built ahead of
time.

## Next

- [renderToString and hydrateRoot](/ssr/render) — the pair.
