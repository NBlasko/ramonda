---
"@ramonda/core": patch
---

`@create`, `@mount` and `@destroy` now receive the render side as an argument.

The decorated method is called with `env: RenderEnv` (`"client" | "server"`), read from the
component's own runtime — so a shared lifecycle method can branch on where it is running (for
example, skip a browser-only fetch during the server render) without a `typeof window` check.
That check is unreliable anyway: server rendering runs under a DOM shim where `window` and
`document` exist, so it can't tell the two sides apart. The argument is correct even inside an
`async` method after an `await`, and even across concurrent server renders.

Declaring the parameter is optional — existing zero-argument lifecycle methods are unaffected.
The `RenderEnv` type is now exported.

Note: this gates where code *runs*, not whether it *ships*. A `server` method's body is still
bundled to the client, so it is not a place for secrets — keep those behind an API.
