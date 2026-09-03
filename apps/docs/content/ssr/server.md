---
title: The server plumbing
description: A DOM to render into and the shell the render goes into — the two pieces every SSR app used to write itself, and got wrong the same two ways.
section: Server rendering
order: 86.5
---

# The server plumbing

[`renderToString`](/ssr/render) turns your app into markup. Two things have to happen around it:
Node needs a DOM to render into, and the markup needs a document to go into. `@ramonda/server` is
those two, and nothing else.

```sh
npm install @ramonda/server
```

It brings its own DOM — you do not install one alongside it.

## The whole loop

```tsx
import { readFile } from "node:fs/promises";
import { renderPage } from "@ramonda/core";
import { fillDocument, installDom } from "@ramonda/server";

const template = await readFile("dist/index.html", "utf8");

async function handle(url: string): Promise<string> {
  const dom = installDom(url);
  try {
    const { body, title, head, portals } = await renderPage(<App />);
    return fillDocument({ template, html: body, title, head, portals });
  } finally {
    dom.close();
  }
}
```

The shell is your built `index.html` with markers where the render goes:

```html
<!doctype html>
<html>
  <head>
    <title>My app</title>
    <!--head-->
  </head>
  <body>
    <div id="app"><!--ssr--></div>
    <!--portals-->
    <script type="module" src="/main.js"></script>
  </body>
</html>
```

## `installDom(url)`

Installs a fresh DOM on `globalThis` for one render, seeded at the request URL — which is also how
[the router](/routing/server) learns which page it is on. It answers a handle with `close()`, and
that is deliberately all it answers: two DOM implementations do not agree on what a window is, and
a caller reaching past this into `dom.window.close()` is what broke every dynamic render once
already.

**It uses linkedom rather than jsdom**, for two reasons that are measured rather than preferred.
linkedom needs no Node built-in, which is what lets the same render run on an edge runtime. And it
is faster where the cost is paid — on every request:

| | linkedom | jsdom |
| --- | --- | --- |
| building a document | 0.018 ms | 4.814 ms |
| a 30-row page, per request | 0.662 ms | 8.530 ms |
| end to end, a live dynamic route | 2.97 ms | 9.49 ms |

linkedom has nothing to close, and that is the point of it: the document is plain objects with no
timers and no event loop, so dropping the reference is the whole cleanup. `close()` exists so that
a DOM which *does* own one is a change to this package alone.

### `installWindow(url, source, options?)`

The globals half on its own, for a DOM you brought yourself — a jsdom, to see whether a fault
reproduces under both, or a single document a static build walks a whole site on.

`navigation` says whose `location` and `history` the render sees. The default, `"request"`, builds
both from `url`: linkedom has neither, and each render is one request at one URL. `"dom"` takes the
DOM's own pair, for a DOM that has a working one — jsdom's `pushState` moves its location, which is
how a sequential prerender changes page without building a document per page.

That choice is an argument rather than something detected, **because detecting it does not work**.
linkedom's window falls through to `globalThis` for anything it does not define, so once a
`location` has been installed for one render, the next window reports that same object as its own —
including to `hasOwnProperty`. A "use the DOM's if it has one" rule therefore reads as true from the
second request onward and pins every later render to the first request's URL.

## `fillDocument({ template, html, title, head, portals })`

Puts the render into the shell and answers the finished page.

**Every substitution is a function**, and that is not a style choice. `String.prototype.replace`
reads `$&`, `` $` ``, `$'`, `$$` and `$1` *in the replacement* as patterns, so a page rendering the
text "Save $$ today" put the marker back into its own output. The page still answered 200, with a
corrupted body. A function replacement is exempt from that reading entirely.

**The title is escaped and the head is not.** `head` is `outerHTML` serialised from real nodes, so
it is already markup; `title` is raw text read back from `document.title`. A page that takes its
title from a product name or a search term decides what lands in the document, and
`</title><script>` is a short string.

**A missing `<!--ssr-->` or `<!--head-->` is returned as it is.** It is a mistake, but a server that
throws answers 500 on every route, and a page with no app in it is the more diagnosable of the two.

**A missing `<!--portals-->` throws**, and it is the one exception. A shell with nowhere to put a
portal produces a page that looks entirely correct and then builds the modal a *second* time on
hydration, because the client found no container to adopt. Silence there ships the fault.

An empty `title` is a report that nothing set one — `renderPage` answers `""` when no
[`Head`](/ssr/head) in the tree spoke — so it is left alone rather than written. Written, it emptied
the shell's own `<title>`.

### `escapeHtml(value)` and `PORTAL_TARGET_ATTR`

`escapeHtml` escapes `&`, `<` and `>`. It takes `unknown` because its commonest caller is an error
page, and what a `catch` receives is not always a string.

`PORTAL_TARGET_ATTR` is the attribute a named [portal](/composition/portal) target's container
carries. The server writes it and the client resolves target names against it; the two must agree
or hydration builds a second copy.

## `parseCookies(header)` and `mimeFor(path)`

```ts
const cookies = parseCookies(req.headers.cookie);
const type = mimeFor("/assets/client.js?v=2"); // "text/javascript"
```

`parseCookies` splits on the **first** `=` only — base64 pads with `=`, so splitting on each one
truncates exactly the cookies that tend to matter. A value that is not valid percent-encoding is
kept raw rather than thrown over: `decodeURIComponent("100%")` throws, and one visitor with a
malformed cookie must not take their request down.

`mimeFor` knows the types a built client actually emits and answers `application/octet-stream` for
everything else — a wrong `Content-Type` is worse than none, because a browser acts on it. It reads
the extension itself rather than importing `node:path`, which would take back the edge-runtime
argument for three lines of code. It also strips a query and a fragment first, so `client.js?v=2`
is JavaScript; `node:path`'s `extname` gets that one wrong.

## What is not here

Routing, the ISR cache and the route plan are [`@ramonda/router/server`](/routing/server). This
package knows nothing about routes.

## Why it is a package

Every SSR app had grown its own copy of these — a DOM installer, a shell filler, a cookie parser —
and the copies drifted. Two faults were found and fixed in **one copy each**: an unescaped
`<title>`, and the `$` sequence above. The scaffolded template still shipped both. A fix that has to
be applied by hand to every app reaches one of them.

## Next

- [Rendering on the server](/ssr/render) — what calls this plumbing, and what it produces.
- [The router on the server](/routing/server) — the other half of a request, if yours has routes.
