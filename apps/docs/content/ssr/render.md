---
title: renderToString and hydrateRoot
description: One turns your app into HTML on the server; the other brings that HTML to life in the browser.
section: Server rendering
order: 91
---

# `renderToString` and `hydrateRoot`

The two ends of server rendering: one turns your app into HTML on the server, the
other brings that HTML to life in the browser.

```ts
// on the server
const html = await renderToString(<App />);

// in the browser
hydrateRoot(<App />, document.getElementById("app")!);
```

## What the server sends

The same components, rendered to HTML — plus one thing a normal render wouldn't have:
**a small blob of each component's state** (`data-ramonda-state` on its element,
holding its `@state` and `@persist`). That is what lets the browser *resume* instead
of starting over — a value the server computed is restored, not recomputed.

## What hydration does

`hydrateRoot` **adopts** the HTML that is already there. It walks your component tree
against the existing DOM and, where they agree, keeps each node — attaching event
handlers, wiring refs, restoring state, running client lifecycle. Nothing is rebuilt
when the two agree (on this page: every element adopted, none replaced).

Where they *disagree*, the browser wins — the DOM is corrected — and development
reports it as [`RMD007`](/ssr/mismatches). See
[hydration mismatches](/ssr/mismatches) for why that happens and how to avoid it.

## Fetching on the server

A component that fetches when it mounts has that finished before the HTML is produced,
so the data is already in the page — see [async on the server](/ssr/async).

## Next

- [Head and metadata](/ssr/head) — per-page title and description.
