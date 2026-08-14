---
"@ramonda/core": patch
"@ramonda/server": minor
"create-ramonda": minor
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

**A scaffolded SSR project ships the head it renders, and has somewhere to put a portal.**

It rendered with `renderToString`, which hands back the body and nothing else — no title, no meta,
no portal blocks. A generated project that added a `<Head>` therefore shipped pages with **no title
and no description**, invisible to exactly the crawlers server rendering exists for. Measured on a
scaffolded project, not inferred. It now renders with `renderPage`, and the shell carries
`<!--head-->` and `<!--portals-->`.

The portals marker is there before anything uses one, on purpose: `fillDocument` refuses a render
that collected blocks with no marker, so without it the first `<Portal target={portalTarget(…)}>`
someone writes breaks their build, and the fix is one line in a file they had no reason to open.

Its ISR entries now cache the **whole document** rather than the body. Filling the shell at send
time works until the shell changes under a cached page — and with a head collected per page, the
head is what goes stale first: one page's cached entry served with another's title.

`fillDocument` also stops taking an EMPTY title literally. `renderPage` returns `""` when no `Head`
set one, which is a report of absence; writing it emptied the shell's own `<title>`, and a
scaffolded project shipped `<title></title>`. Found by building one.
