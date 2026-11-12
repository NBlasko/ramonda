---
"create-ramonda": patch
---

The SSR template's `scripts/prerender.mjs` empties `dist/static` before it bakes. It is the folder's only writer and never emptied it, so a page baked by an earlier build — a route since deleted or renamed, or a file written then — stayed there, and `npm run build:static` put it online. An existing project can copy the one `rm` line into its own script.
