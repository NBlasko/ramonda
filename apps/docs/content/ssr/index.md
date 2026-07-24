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

## SSG or SSR?

Two flavours, the same tools:

- **Static (SSG)** — render at *build time*, write HTML files, serve them from a CDN.
  No server, no per-request cost. This is what these docs do, and where to start.
- **Server (SSR)** — render *per request*, for pages that depend on who is asking.

Start static; move a page to per-request rendering only when it genuinely can't be
built ahead of time.

## What Ramonda gives you

The same components and lifecycle — there is no separate server renderer to learn.
The [`env`](/ssr/env) option decides what runs where.

| | |
|---|---|
| [`renderToString`](/ssr/render) | your app → HTML |
| [`renderPage`](/ssr/head) | the HTML plus the `<head>` its components set |
| [`renderDocument`](/ssr/static) | wraps that in a full HTML document |
| [`hydrateRoot`](/ssr/render) | in the browser, adopts the server's HTML |
| [`routePaths`](/ssr/static) | the paths a static build should render |

## Next

- [renderToString and hydrateRoot](/ssr/render) — the pair.
