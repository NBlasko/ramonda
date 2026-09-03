---
title: renderToString and hydrateRoot
description: One turns your app into HTML on the server; the other brings that HTML to life in the browser.
section: Server rendering
order: 81
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
**a pair of HTML comments around each component's nodes**, carrying a small blob of its
`@state` and `@persist` on the opening one.

```html
<tr><!--c7 {"state":{"open":true}}--><td>Ada</td><td>9</td><!--/c7--></tr>
```

They are there because served markup is text. A component owns a run of nodes, and
nothing in plain HTML says where one component's run ends and the next one's begins —
so the server says it, in comments, because a comment is the only thing the HTML parser
leaves alone inside a `<tr>`, and an attribute would need an element the component may
not have.

The blob is what lets the browser *resume* instead of starting over: a value the server
computed is restored rather than recomputed. A field still holding the primitive its own
initializer produced is left out of it — the browser's initializer produces that again,
so the bytes would buy nothing.

Hydration reads the comments, uses them, and takes them out. By the time the page is
interactive it holds exactly what a client-side render would have produced: your own
markup, with nothing of the framework's in it.

## What hydration does

`hydrateRoot` **adopts** the HTML that is already there. It walks your component tree
against the existing DOM and, where they agree, keeps each node — attaching event
handlers, wiring refs, restoring state, running client lifecycle. Nothing is rebuilt
when the two agree (on this page: every element adopted, none replaced).

Where they *disagree*, the browser wins — the DOM is corrected — and development
reports it as [`RMD007`](/reference/diagnostics/rmd007). See
[hydration mismatches](/ssr/mismatches) for why that happens and how to avoid it.

## Fetching on the server

A component that fetches when it mounts has that finished before the HTML is produced,
so the data is already in the page — see [async on the server](/ssr/async).

## Next

- [Head and metadata](/ssr/head) — per-page title and description.
