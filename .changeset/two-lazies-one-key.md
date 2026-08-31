---
"@ramonda/check": minor
---

`lazy-imports-that-collide` — two `lazy` functions written the same way, loading different modules

`AsyncLoad` keys its module cache on the SOURCE of the `lazy` it is given: `cacheKeyFor` reads
`props.lazy.toString()`. That is right for the ordinary case and wrong for one —
`() => import("./Panel")` is a single string and a **different module in every directory it is
written in**, so two of those land on one cache entry.

`RMD049` already reports it, and the runtime resolves it safely: it PROVES the collision by
comparing both loaded modules, then mints the newcomer a key of its own. But it can only do that
once both sites have actually rendered, in a development build, in one session. From the source both
are visible at once.

Mirrors the runtime's boundaries rather than inventing its own. Silent on:

- **the same text in one directory** — it names one module, and `claim()` fires only when the two
  load *different* things;
- **a bare specifier** — `import("@acme/panel")` is the same package wherever it is written;
- **an explicit `cacheKey`** — the app's own claim about identity, which the runtime believes;
- **any element that spreads** — this is settled by an attribute that is NOT written, and a spread
  may be carrying it.

Followed one hop through a name, because a module-level `const loadPanel = () => import("./Panel")`
is what the documentation recommends — and a name is the spelling most likely to be copied between
files, so reading only the attribute would have gone silent on the shape most at risk.

Reports 0 across the documentation app, the three playgrounds, the router, the query and the form
packages.
