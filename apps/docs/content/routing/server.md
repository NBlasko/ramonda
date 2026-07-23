---
title: The router on the server
description: What a server render does with the URL, and why the client's URL wins on hydration.
section: Routing
order: 85
---

# The router on the server

The router works during a server render with no special entry point and no server-only API. What
changes is which lifecycle runs.

## The URL comes from the request

`Router` reads `window.location` at startup, so the server render's DOM has to be pointed at the
request URL. A build loop does the same thing with `history.pushState` between pages:

```ts
for (const path of paths) {
  window.history.pushState(null, "", path);
  const page = await renderPage(<App />);
  write(path, renderDocument(page));
}
```

No router API was added for this, and none should be: a router that could only be told "you are
at /users/42" through a server-only entry point would be a second code path to keep honest.

## What does not run

- **No `popstate` listener.** It is an `@onWindow` effect, and effects never run during a server
  render. A server render has no history to react to.
- **The "second Router" counter is not touched.** It is incremented in `@create({ env: "client" })`,
  because a server render never unmounts — so a shared counter would leak and the second
  `renderToString` in a process would throw.

Both of those were real bugs, and both came from the same mistake: a lifecycle defaulting to
`shared` when the work was client-only. See [client/server/shared](/ssr/env).

## The client's URL wins over the server's

`Router.routeState` is a `@state` field, and `@state` is serialized into the hydration blob — so
the route the **server** rendered travels to the client and is restored there before any client
lifecycle runs.

That is why the router re-reads the URL in `@create`:

```
1. field initializer  → parseUrl()          the client's URL
2. restore from blob  → the SERVER's route  ← overwrites (1)
3. @create init()     → parseUrl()          the client's URL again
```

Without step 3, a client hydrating at a **different** URL than the server rendered — a cached
page, a CDN serving one document for many paths, a client redirect between request and
hydration — would keep the server's route and render the wrong page, with no error.

**And a warning from proving that.** Removing step 3 and checking the rendered page passes: the
first render is correct anyway, because the route context's options were captured before the blob
was restored. The DOM is right while the state is wrong. Assert the state, not just the markup.

## Static builds

See [building a static site](/ssr/static). `routePaths(routes)` gives you the literal paths to
render, and tells you which patterns it cannot enumerate.

## Next

- [Why prerender](/ssr) — and what it buys.
