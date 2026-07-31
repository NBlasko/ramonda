---
"@ramonda/core": minor
---

Add `renderStatic(vnode, url)` — the build-time render that PROVES a route holds no
per-request data before it is baked.

It renders with the request context poisoned (`requestContext()` reads throw and are
recorded), and returns either `{ html }` — safe to bake — or `{ blockedBy }` naming the
per-request field that was read, meaning the route cannot be prerendered and must fall back
to per-request rendering. This is the guard that makes opt-in SSG safe: a page that reads a
cookie, header, or seeded value literally cannot be turned into static HTML, so one visitor's
data can never end up in another's cached page.

It catches reads wherever they happen — `render()`, `@create`, and even an async `@mount`
(whose throw is swallowed by the render drain, so the read is *recorded* on the scope and
checked afterwards). `url` stays readable throughout (it is the page identity). Sequential by
design (a build renders one page at a time) — not for serving concurrent requests.
