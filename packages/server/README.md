# @ramonda/server

The plumbing a Ramonda server render needs: a DOM to render into, and the document the render goes
into.

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fserver)](https://www.npmjs.com/package/@ramonda/server)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fserver)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. See the
> [root README](https://github.com/NBlasko/ramonda#readme).

```bash
pnpm add @ramonda/server
```

Documentation: **[ramonda.dev/ssr/server](https://ramonda.dev/ssr/server)**

It brings its own DOM — you do not install one. That is deliberate: `linkedom` was a peer once, an
app put it in `devDependencies`, and a production install produced a server that started and then
died on `ERR_MODULE_NOT_FOUND`.

```js
import { fillDocument, installDom, mimeFor, parseCookies } from "@ramonda/server";

const dom = installDom(`http://localhost:5173${req.url}`);
try {
  const { html, title, head } = await render({ cookies: parseCookies(req.headers.cookie) });
  res.end(fillDocument({ template, html, title, head }));
} finally {
  dom.close();
}
```

Routing is not here. The route plan, the ISR cache and the render modes are
[`@ramonda/router/server`](https://www.npmjs.com/package/@ramonda/router); this package knows
nothing about routes.

## Why it exists

Every SSR app grows its own copy of these, and the copies drift. In this repository, three of them
did:

- One project's `server.mjs` and its `scripts/prerender.mjs` each had a DOM installer. The server
  was moved from jsdom to linkedom; the prerender step was not. The build bundled successfully and
  then died at prerender with `ERR_MODULE_NOT_FOUND`.
- An unescaped `<title>` and a `$`-sequence corruption were found and fixed in **one** copy of the
  shell fill. The scaffolded template shipped both for months afterwards.

A fix that has to be applied by hand to every app reaches one of them.

## `installDom(url)`

A fresh DOM on `globalThis`, seeded at the request URL — which is also how the router learns the
page. Returns a handle:

```js
const dom = installDom("http://localhost:5173/users/42");
// … render …
dom.close();
```

**A handle rather than the DOM.** Two implementations do not agree on what a window is, and a
caller reaching past this into `dom.window.close()` — jsdom's shape, not linkedom's — is what broke
every ISR and dynamic render once already.

**linkedom, not jsdom.** It needs no Node built-in, which is what lets the same render run on an
edge runtime, and it builds a document in 0.018 ms against jsdom's 4.814 — a cost paid on every
request. Measured on a 30-row page against a production build: 0.662 ms per request against
8.530 ms, and end to end on a live dynamic route, 2.97 ms against 9.49 ms.

### `installWindow(url, window, options?)`

The globals half, for a DOM you built yourself.

```js
const dom = new JSDOM(shell, { url });
installWindow(url, dom.window, { navigation: "dom" });
```

`navigation` decides whose `location` and `history` the render sees, and a DOM that has neither is
refused rather than rendered against `undefined`. `"request"`, the default,
builds both from `url`: the DOM has none, and each render is one request at one URL. `"dom"` takes
the DOM's own pair — jsdom's `pushState` moves its location, which is how a sequential prerender
walks a whole site on a single document instead of building one per page.

It is an argument rather than something detected, because detecting it does not work: linkedom's
window falls through to `globalThis` for anything it does not define, so the window built for the
*second* request reports the first request's location as its own.

## `fillDocument({ template, html, title, head })`

The render, put into the shell — `<!--ssr-->` for the app and `<!--head-->` for its head.

```js
fillDocument({ template, html, title: document.title, head });
```

**Every substitution is a function replacement.** `String.prototype.replace` reads `$&`, `` $` ``,
`$'`, `$$` and `$1` in the *replacement* as patterns, so a page rendering a price — "Save $$ today"
— put the marker back into its own output and still answered 200.

**The title is escaped and the head is not.** `head` is `outerHTML` serialised from real nodes, so
it is already markup. `title` is raw text read back from `document.title`, so a page that titles
itself from a product name or a search term decides what markup lands in the document.

A shell missing a marker is returned as it is: a server that throws answers 500 on every route, and
a page with no app in it is the more diagnosable of the two.

## `parseCookies(header)` and `mimeFor(path)`

`parseCookies` reads a `Cookie` header into the `Map` a request context wants. It splits on the
first `=` only, because base64 pads with `=`, and it keeps a value raw rather than throwing when it
is not valid percent-encoding — one visitor with a malformed cookie should not take their request
down.

`mimeFor` answers the content type for a built asset, and `application/octet-stream` for anything it
does not know. A wrong `Content-Type` is worse than none, since a browser acts on it.

## License

MIT
