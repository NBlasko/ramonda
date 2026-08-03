---
"create-ramonda": minor
---

The SSR template renders on linkedom instead of jsdom

A scaffolded SSR project gets `linkedom` where it used to get `jsdom`, and `server.mjs` builds its
document with it.

Two reasons, both measured against this repo's SSR playground running its whole smoke suite on each:

- **It needs no Node built-in**, where jsdom needs ten. That is what lets the same server run on
  Cloudflare Workers, Deno Deploy or Vercel Edge, which jsdom cannot.
- **It is faster per request**, and the gap is mostly construction — which `installDom` pays on every
  request. On the live server, a real dynamic route: 9.49 ms → 2.97 ms. In isolation, a 30-row
  render: 8.53 ms → 0.66 ms, of which 4.8 ms was jsdom building a document before any rendering
  started.

The output was compared rather than assumed: across 111 nodes of a prerendered page, ignoring
attribute order, exactly one thing differs — jsdom writes `style="display: contents;"` and linkedom
`style="display: contents"`, because jsdom normalises through its CSS parser. Same CSS, one byte.

Three globals linkedom does not supply are provided by the template: `location` is real, since the
router reads it during a server render, and is built from the request URL; `history` accepts and
discards, because a server has no session history; `MouseEvent` and `getComputedStyle` are stubs so a
module that merely references one at import does not throw.

**`jsdom` is still installed by the `testing` add-on**, in both modes now rather than SPA only. There
it stands in for a BROWSER — vitest's `environment: "jsdom"` — which is a different job from being
the DOM a server renders into, and one linkedom is not trying to do. An SSR project with tests
previously got jsdom for free from the server; it no longer does, so it is requested explicitly.
