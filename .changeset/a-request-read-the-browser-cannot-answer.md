---
"@ramonda/check": minor
---

`client-only-request-read`: a request read on a path that only runs in the browser, where the value it names can never be.

Closes the gap item 26C measured on 2026-08-17. A component reading a request key in a handler **bakes
cleanly under a static build** — `html` present, no `blockedBy` — because the read never runs during
the render, so the build's per-request poison is never touched. The page ships, and the browser reads
`undefined` and reports RMD025. The build was silent although the outcome was certain in advance.

**Why this is provable rather than a suspicion.** The client's request scope carries exactly the live
`url`, an empty cookie map, empty headers, and the values whose keys opted into `exposeToClient` and
which the server seeded. So three reads are certain to find nothing there:

- `cookies.get(…)` / `cookies.has(…)` — a cookie is the server's, and an httpOnly one is invisible to
  JavaScript in any case, so nothing can ever expose it.
- `headers` — the same.
- `get(key)` where the key resolves to a `requestKey(…)` declaration that did not opt in.

The rule is not asking whether a value will be there; it is naming one that cannot be.

**Client-only is read off the framework, not guessed.** `@updated` is skipped for `env === "server"` in
`flushUpdated`; `@interval`, `@timeout`, `@onWindow`, `@onDocument` and `@onElement` are built on
`createSubscriptionDecorator`, which attaches an effect, and `runComponentEffects` returns immediately
on the server; `@deferHydration` belongs to hydration, which only happens in a browser;
`@created`/`@mounted`/`@destroyed` count only when written `{ env: "client" }`. Plus a JSX event
handler — an arrow inside an `on*` attribute, or a method whose every in-class reference is one.

**What it will not say, and each silence is a decision.** A `shared` lifecycle, which is the DOCUMENTED
way to read the request and would otherwise be reported as the fault it fixes. An exposed key, because
whether the server seeded it is runtime. A key it cannot resolve to a `requestKey` — unresolved is not
the same as unexposed. `url`, which is read live from `location` in the browser. And a handler that is
also called from a shared lifecycle, since one of its callers runs on the server.

Measured for false positives before shipping, the same way the last rule was: **zero hits across
`apps/docs`, both playgrounds, and query, router and form.** The fixture holds nine faults and nine
correct arrangements, and the test asserts both halves of each report — why the value is absent and why
the line only runs where it cannot be.

`/ssr/request` now says so where a reader would look, next to `exposeToClient`.
