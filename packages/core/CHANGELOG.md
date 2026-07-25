# @ramonda/core

## 0.0.2

### Patch Changes

- 7b530bb: Fix an unhandled rejection in dev mode when `@ramonda/devtools` isn't installed.

  In development, core dynamically imports the optional `@ramonda/devtools` for its
  side effect (registering the in-page inspector). That import had no `.catch`, so in a
  project that never installed devtools — e.g. a scaffold created with the testing add-on
  but not the devtools one — running a test surfaced a stray
  `Cannot find package '@ramonda/devtools'` unhandled rejection, even though the test
  itself passed. The import is now guarded to the browser (`typeof document`) and its
  absence is swallowed: no devtools just means no inspector, not an error.

- 72fb118: **Breaking:** unify hook input on `props`, and rename `@shouldUpdateProps`.

  A hook's input is now called **props**, the same word (and idea) as a component's —
  read from `this.props`, not `this.options`. One concept, one name. The `HookOptions`
  type is now `HookProps`, and a write to a hook's props throws `RMD015` worded around
  `props`.

  ```ts
  // before
  class Counter extends Hook<CounterOptions> {
    @state n = this.options.start;
  }
  // after
  class Counter extends Hook<CounterProps> {
    @state n = this.props.start;
  }
  ```

  The `@shouldUpdateProps` decorator is now **`@shouldUpdateOnPropsChange`**. The old
  name read like "should the props update" — but props always update; the decorator
  decides whether new props from the parent are _taken up at all_ (their signals update
  and a render is scheduled). Returning `false` drops the whole update, props included —
  this is now documented accurately. It runs only on prop changes, never on the
  component's own `@state` writes. It is **components only** and now throws if placed on
  a hook (a hook has no parent-driven prop update to gate), instead of silently doing
  nothing.

- 7b530bb: `@create`, `@mount` and `@destroy` now receive the render side as an argument.

  The decorated method is called with `env: RenderEnv` (`"client" | "server"`), read from the
  component's own runtime — so a shared lifecycle method can branch on where it is running (for
  example, skip a browser-only fetch during the server render) without a `typeof window` check.
  That check is unreliable anyway: server rendering runs under a DOM shim where `window` and
  `document` exist, so it can't tell the two sides apart. The argument is correct even inside an
  `async` method after an `await`, and even across concurrent server renders.

  Declaring the parameter is optional — existing zero-argument lifecycle methods are unaffected.
  The `RenderEnv` type is now exported.

  Note: this gates where code _runs_, not whether it _ships_. A `server` method's body is still
  bundled to the client, so it is not a place for secrets — keep those behind an API.

- 30979b6: Add **RMD019**, a dev-mode diagnostic for non-serializable `@state`.

  `@state` is carried to the client in the hydration blob as JSON, so it can only hold
  JSON-serializable data. Assigning a **function**, **symbol**, or **bigint** to a
  `@state` field — at its initializer or a later write — is now reported (dev only), at
  the moment it happens, on the client too. Previously this was only noticed by the SSR
  serializer, and only during a server render.

  The check is scoped to `@state` (not props, which legitimately hold callback
  functions) and is O(1), so it stays off the hot path's back. Deeper cases (a `Map`, a
  circular object) remain the SSR serializer's job.

- 7b530bb: Server renders can now redirect the request instead of producing a page.

  New exports `ServerRedirect` and `captureServerRedirect`. When code in the tree
  asks — during a server render — to navigate elsewhere (a route guard sending an
  unauthenticated visitor to `/login`, say), `renderToString` throws `ServerRedirect`
  rather than returning markup. A server boundary catches it and answers with a
  redirect (a 302 and a `Location`), so the browser navigates to the right URL and
  requests the correct page — instead of being handed markup for the wrong one, which
  would then snap back the instant the client read `window.location`.

  `captureServerRedirect()` is the low-level primitive the router builds on: called
  synchronously while the tree is being built, it returns a function that records a
  redirect for _this_ render (or `undefined` on the client). First writer wins.
  `renderPage` also clears the document head on the redirect path so a long-lived
  server process cannot leak one request's head tags into the next.
