---
title: The router on the server
description: How routing works during a server render, and why the browser's URL wins on hydration.
section: Routing
order: 75
---

# The router on the server

The router works during [server rendering](/ssr) with no special API — what changes
is only which lifecycle runs.

## The URL comes from the request

`Router` reads `window.location` at startup, so the server points its DOM at the
request URL before rendering. A static build does the same, with `pushState` between
pages:

```ts
for (const path of paths) {
  window.history.pushState(null, "", path);
  const page = await renderPage(<App />);
  write(path, renderDocument(page));
}
```

There is no server-only router API — the same code renders on both sides.

## The browser's URL wins on hydration

The route the server rendered travels to the browser in the hydration data, and then
the router re-reads the actual URL as it starts up. That last step matters: if the
browser is at a *different* URL than the server rendered — a cached page, a CDN
serving one file for many paths, a redirect between request and hydration — re-reading
is what makes it show the right page instead of the server's.

## Route guards and redirects

A guard is just navigation from a lifecycle method — check something, and if the
visitor should be somewhere else, send them:

```tsx
class Account extends Component {
  private route = this.use(Navigator);

  @mount guard() {
    if (!isSignedIn()) this.route.replace("/login");
  }

  render() {
    return <h1>Your account</h1>;
  }
}
```

`@mount` runs on both sides (it's `shared`), which is what makes this work on the very
first load. On the client the `replace` is an ordinary navigation. On the server there
is no history to change and no client to re-render for, so the render instead **signals
a redirect**: `renderToString` throws a `ServerRedirect`, and the server answers with a
302 to `/login`. The browser then requests `/login` and gets the right page — rather
than being handed the account page for a URL it isn't allowed to see, which would only
flash and snap back on hydration.

Your server boundary translates the throw into a response. The SSR starter does this
for you; by hand it is:

```ts
import { renderToString, ServerRedirect } from "@ramonda/core";

try {
  const html = await renderToString(<App />);
  // …send the page
} catch (err) {
  if (err instanceof ServerRedirect) {
    res.statusCode = err.status; // 302
    res.setHeader("Location", err.url);
    res.end();
  } else {
    throw err;
  }
}
```

The earliest guard to fire wins, so one redirect decides where the request goes.

> **This gates where code runs, not what it protects.** A guard keeps a page from
> *rendering* for the wrong visitor, but the component's code still ships to the
> browser. Real authorization belongs at the API — see
> [client / server / shared](/ssr/env).

## What doesn't run on the server

- The `popstate` listener (a subscription, and subscriptions are client-only — there is
  no history to react to on the server).
- Client-only setup like the single-`Router` check, keyed to
  `@create({ env: "client" })`.

See [client / server / shared](/ssr/env) for how lifecycle picks a side.

## Static builds

`routePaths(routes)` gives you the concrete paths to render, and flags any pattern it
cannot list out. See [building a static site](/ssr/static).

## Next

- [Why prerender](/ssr) — and what it buys.
