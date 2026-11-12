---
"create-ramonda": patch
---

The SSR template's dev server recovers on the next request after a failed server load. Vite keeps a failed import in its module graph: measured on Vite 8.3.4 alone, an import written before its file went on failing after the file was created, until the dev server restarted. A failed load now forgets the graph, so the next request loads afresh. An existing project can copy the one line into `renderDev`'s `catch` in `server.mjs`: `vite.moduleGraph.invalidateAll();`.
