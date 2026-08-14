---
"@ramonda/check": minor
---

A component reading `window.location` where the router already knows.

The two are the same fact from two sources, and only one is reactive: read from the router, a
component re-renders when the route moves; read from `window`, it is a snapshot taken once and
never corrected, so the page quietly goes out of date. The router also keeps a distinction the URL
hands over as one string — `#tab=film` is route state and `#a-section` names an element — so a hash
tag with a `value` is the first and one without is the second.

```
[ramonda-check] 1 component(s) reading the browser's URL, not the router's:

  src/Article.tsx:31:20
    <Article> reads `window.location.hash` — the router answers this with `hashTags`.
```

`window.location`, `globalThis.location`, `document.location` and a bare `location`. The report
names the router's member where one answers the same question and says nothing where none does —
`location.origin` gets no invented replacement.

**A read, and only a read.** `window.location.href = "…"` is a different fault with a different
answer, and `location.reload()` is the one thing the router genuinely cannot replace; reported as
reads, both would be advice to do something impossible.

**Two things it deliberately does not report.** A project that imports no router: there `location`
is the only place the answer lives, and a rule that reports the only thing you could have written
is a rule people switch off. And a local variable called `location`, which is not the global —
telling them apart costs no type, because this runs with `noLib` and no `@types`, so the browser's
own name resolves to nothing while one written in the source resolves where it is written.

**A warning, not a failure**, which is the rule here for adding a rule: one version that says so,
the next that refuses. Measured across this repository: zero reports. The router reads
`window.location` in `urlUtils.ts` because it owns it, and core reads it behind a `typeof` guard for
SSR; neither is a component with a router above it.
