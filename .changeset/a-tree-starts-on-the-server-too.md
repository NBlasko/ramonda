---
"@ramonda/check": minor
"@ramonda/core": patch
---

An app entered only from a server is judged. It used to pass in silence.

`renderToString`, `renderPage` and `renderStatic` are roots now, alongside `bootstrap` and
`hydrateRoot`. All five are handed a component and render it; only the browser's two were read.
Measured on one file with a consumer and no provider above it, changing nothing but the last line:

```
bootstrap(<App />, null)     <Reader> consumes "Theme" — nothing provides it on this path
renderToString(<App />)      0 root(s) — every consumer has a provider above it
```

The second sentence was never checked. With no root the walk has nowhere to start, the project is
taken for a library, and a library is judged not at all — so an SSR-only app got a green line over
code nothing had looked at, which is the failure this package exists to prevent.

**An entry is called by its own name.** A component method that shares one is not an entry: two
apps in this repository have a `renderPage(row)` that builds the markup for one row of data, and
reading the callee by name would make a root out of a row.

Also fixed while measuring it: `--split` counted a root as a declaration in the first payload. A
root is a CALL, not a declaration — it is walked through and never counted.

`@ramonda/core` gains two escape-hatch comments in `hydration/ssr.ts`, where `renderPage` and
`renderStatic` forward the tree they were handed to `renderToString`. Nothing else changes there.
