---
"@ramonda/core": minor
"create-ramonda": minor
---

**Breaking:** `renderToString` is no longer exported, and `RenderToStringOptions` is `RenderPageOptions`.
It returned the body alone, which `renderPage` returns beside the title, the head, `lang`, `data` and the
portals — so a page served from it lost all of them, and the docs taught it for serving pages while
the scaffold's own server warned against it. Write `const { body } = await renderPage(<App />, opts)`.
