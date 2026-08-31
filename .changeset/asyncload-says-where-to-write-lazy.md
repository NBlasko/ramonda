---
"@ramonda/core": patch
---

`AsyncLoad` stops recommending the shape it reports

Its own docstring wrote `lazy={() => import("./HeavyChart")}` and an inline arrow for
`errorFallback`, while `RMD020` reported both — measured, with `strictRender` on, as
`AsyncLoad.lazy` and `AsyncLoad.errorFallback`. The framework was arguing with itself, and the
side that loses is the reader who copied the example.

The examples now hoist the thunk — `const loadChart = () => import("./HeavyChart")` — and pass a
bound method for the fallback. An `import()` inside a thunk does not run until the thunk is
called, so hoisting costs nothing, and a table of them is the answer when the module is chosen at
runtime: `lazy={pageLoaders[path]}`, which is what the documentation site already did.

The module CACHE still tolerates a rebuilt `lazy` — the key is derived from the thunk's source
rather than its identity, so nothing loads twice. The docstring now says that is a defence against
the mistake rather than a licence for it: what the cache cannot save you is the render.

Comments only; no behaviour changed.
