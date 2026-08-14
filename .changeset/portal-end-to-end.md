---
"@ramonda/core": patch
"@ramonda/server": minor
---

A prerendered page keeps its named portal targets, and a hand-assembled shell can place them.

`Portal`'s plan was that a portalled subtree should be indistinguishable from a normally mounted
one — full SSR into any named target, state restored on hydration, `list()` working inside it.
Every part of that had unit tests and **not one application used it**, in this repository or in the
docs site. Rendering one through a real build found two holes, both silent:

**`renderStatic` dropped `portals`.** `renderPage` returns them; the build-time render that bakes a
static page did not, and did not reset its containers before rendering either. A prerendered page
therefore lost every named portal block — the file looked correct, and the client built the subtree
a SECOND time on hydration because there was no container to adopt. Only a real static build could
show it.

**A hand-assembled shell had nowhere to put them.** `renderDocument` emits a container per target,
but an app that writes its own shell — which the SSR template and this repository's playground both
do — had no supported way to. `fillDocument` now takes `portals` and fills a `<!--portals-->` marker:

```js
res.end(fillDocument({ template, html, title, head, portals }));
```

```html
<div id="app"><!--ssr--></div>
<!--portals-->
```

A shell with blocks to place and no marker **throws**, naming the targets. That is the one missing
marker not returned quietly: a missing `<!--ssr-->` gives a page with no app in it, which announces
itself, while a dropped portal gives a page that looks perfect and then duplicates a modal in the
browser.

The markup matches `renderDocument` exactly — same attribute, same escaping, same position after
the app root — because the two disagreeing is itself a way to make hydration rebuild.
