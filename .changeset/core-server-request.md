---
"@ramonda/core": minor
---

`renderToString(vnode, { request })` — per-request server renders, so `requestContext()`
returns real values.

Pass `{ request: { url, cookies?, headers?, values? } }` and the render runs in "server" mode:
`requestContext().cookies` / `.headers` / `.get(key)` return the request's real data instead of
throwing. This is the dynamic (SSR) counterpart to `renderStatic`'s poisoned build render.

The scope is live only across the render's **synchronous** section (the same window and the same
concurrency guarantee as `renderEnv` — two concurrent requests must not share it across an
`await`). So read `requestContext()` **synchronously**: in `render()`, in `@create`, or before an
`@mount`'s first `await`. The idiomatic pattern needs nothing more — read the request in `@create`
and store it in `@state`; `@create` is skipped on hydration and the `@state` is restored from the
page's state blob, so the client never re-reads the request and there is no separate request blob
to ship. New types: `RenderToStringOptions`, `ServerRequestInit`.
