---
title: Why prerender
description: Send finished HTML instead of an empty shell — for search engines, link previews, and first paint.
section: Server rendering
order: 80
---

# Why render on the server

A client-only app ships an almost-empty page and builds everything with JavaScript
after it loads. **Server rendering** flips that: the server produces the finished
HTML, sends it, and the browser then attaches behaviour to what is already there.

Two reasons it matters:

**Search engines and link previews see real content.** A client-only page arrives as
an empty `<div id="app">`, so anything reading it without running JavaScript — most
crawlers, and the bots feeding AI assistants — sees nothing. A server-rendered page
arrives as the whole page, as text.

**It paints sooner.** The content is in the HTML, so it shows the moment the HTML
arrives. The "download the bundle, run it, then see something" wait happens *behind*
content the reader can already read.

## SSG or SSR? — per route

You don't pick one for the whole app. Each route renders the way it needs:

- **Static (SSG)** — render at *build time*, write an HTML file, serve it from anywhere.
- **Dynamic (SSR)** — render *per request*, for pages that depend on who is asking.
- **ISR** — baked, then re-rendered on a timer, for slow-changing pages.

You declare this per route, and the build **refuses to bake a page that reads the request** — so
one visitor's data can never end up in another's cached page. See
[rendering modes](/ssr/modes) for how, and start static: mark a route dynamic only when it
genuinely depends on the request.

## What Ramonda gives you

The same components and lifecycle — there is no separate server renderer to learn.
The [`env`](/ssr/env) option decides what runs where.

| | |
|---|---|
| [`renderToString`](/ssr/render) | your app → HTML |
| [`renderPage`](/ssr/head) | the HTML plus the `<head>` its components set |
| [`renderDocument`](/ssr/static) | wraps that in a full HTML document |
| [`hydrateRoot`](/ssr/render) | in the browser, adopts the server's HTML |
| [`renderStatic`](/ssr/modes) | a build render that refuses to bake a per-request page |
| [`requestContext`](/ssr/request) | read cookies / headers / the user during a render |
| [`defineServer` · `routePlan`](/ssr/modes) | per-route rendering modes (server-only) |

## Next

- [renderToString and hydrateRoot](/ssr/render) — the pair.
- [Rendering modes](/ssr/modes) — static, dynamic, and ISR per route.
