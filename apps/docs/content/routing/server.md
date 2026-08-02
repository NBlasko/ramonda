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

A guard is navigation from a lifecycle method — check something, and if the visitor
should be somewhere else, send them. But **the guard is only half of it**, and the other
half is what `render()` does meanwhile:

```tsx
class Account extends Component {
  private route = this.use(Navigator);
  private session = this.use(SessionConsumer);

  @mount guard() {
    if (!this.session.user) this.route.replace("/login");
  }

  render() {
    // This still runs, even when the guard has just asked for a redirect.
    if (!this.session.user) return null;
    return <h1>{this.session.user.name}</h1>;
  }
}
```

`SessionConsumer` is your own [context](/composition/context) — one place decides who is
signed in and publishes the answer, and every page reads it. What matters is that reading
it is instant: no `await`, no request. The next two sections are why.

`@mount` runs on both sides (it's `shared`), which is what makes this work on the very
first load. On the client the `replace` is an ordinary navigation. On the server there
is no history to change and no client to re-render for, so the render instead **signals
a redirect**: `renderToString` throws a `ServerRedirect`, and the server answers with a
302 to `/login`. The browser then requests `/login` and gets the right page — rather
than being handed the account page for a URL it isn't allowed to see.

### A guard does not stop this render

On the server it does — nothing is sent at all. **In the browser it does not.** The
component is built, `render()` runs, and the navigation the guard asked for is applied
afterwards. That is why the example above returns `null` rather than trusting the guard.

The obvious worry is that this means the visitor *sees* the page first. It does not, and
the reason is worth knowing: **one update is one drain, not one render.** Someone clicks
through to `/account`, the router rebuilds, the account page is built and committed, its
`@mount` asks for `/login` — and that redirect is picked up by the same drain, before it
returns. Both renders happen inside one microtask, and the browser paints after
microtasks, so `/login` is the first thing anyone can see.

So "it renders" is about what your code *runs*, not about what a visitor *looks at*. Two
things follow from the running, and both are worth getting right:

**`render()` has to be safe for a visitor who is not allowed here.** It runs before the
redirect lands, so `this.session.user.name` on a signed-out visitor throws instead of
redirecting — and a thrown render is not a redirect, it is a broken page. Read a value
that exists either way, and bail.

**Any other `@mount` on the component runs too.** A `fetch("/api/account")` in a second
`@mount` fires for the visitor you are turning away. Put per-page loading behind the same
answer the guard uses, or accept the wasted request and the 401.

### Do not make the check asynchronous

Everything above holds only while the check answers **straight away**. That is what keeps
the whole thing inside one drain, and one drain inside one microtask.

A guard that **awaits** — a token check against the server — breaks it, and there is no
batching that helps. The await releases the frame, the browser paints, and the visitor
sits looking at the protected page until the answer comes back:

```tsx
// ✗ The account page is on screen while this waits.
@mount async guard() {
  const ok = await fetch("/api/session").then((r) => r.ok);
  if (!ok) this.route.replace("/login");
}
```

So **decide before you render**. Validate the session once, high up — on the server for
the first load, in one place on the client afterwards — and publish the answer as
[context](/composition/context) or state. The guard then reads it synchronously, and so
does `render()`.

If the answer genuinely is not known yet, say so in the markup rather than showing the
page: render your loading state until it arrives. "Unknown" is a third state, not a
temporary "yes".

### Hydration is the case that picks the lifecycle

`@mount` is `shared`, and on hydration it **re-runs** on the client. `@create` is
`shared` too, but on hydration it is **skipped** — the server already ran it and the
state it wrote was restored from the page.

That matters here for the exact reason described above: a cached page, or a CDN serving
one file for many paths, can put markup in front of someone the server never checked. A
guard in `@mount` fires on that hydration. A guard in a plain `@create` does not.

So: **guard in `@mount`**. `@create` runs earlier on a client navigation — before
`render()` rather than after the commit — but it is silent on the one path where the
browser's answer can differ from the server's.

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

> **A guard routes people; it does not protect data.** It decides which page someone
> lands on. It does not stop the component's code from shipping to the browser, and it
> cannot stop anyone from calling your API directly — the network tab is right there.
> Every endpoint has to check for itself. See
> [client / server / shared](/ssr/env).

## What doesn't run on the server

- The `popstate` listener (a subscription, and subscriptions are client-only — there is
  no history to react to on the server).
- Client-only setup like the single-`Router` check, keyed to
  `@create({ env: "client" })`.

See [client / server / shared](/ssr/env) for how lifecycle picks a side.

## Rendering modes per route

A route can be baked at build (static), rendered per request (dynamic), or cached and
refreshed (ISR) — declared server-side with `defineServer`, checked exhaustively against your
route table. A page that reads the request can't be baked (the build enforces it). See
[rendering modes](/ssr/modes).

## Static builds

`routePaths(routes)` gives you the concrete paths to render, and flags any pattern it
cannot list out. See [building a static site](/ssr/static).

## Next

- [Why prerender](/ssr) — and what it buys.
