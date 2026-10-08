---
"create-ramonda": patch
---

**The server-rendered template links the stylesheet its build writes.** With `@ramonda/css` added, a
block compiled, its class reached the page and esbuild wrote `client.css` beside the bundle — and the
page linked nothing, so it shipped unstyled. `scripts/build.mjs` now writes the page shell once, with
the built script and, when there is one, the stylesheet; `server.mjs` and `scripts/prerender.mjs`
read that file. Its `shared` options also have an empty `plugins` array, where a bundler plugin goes.
