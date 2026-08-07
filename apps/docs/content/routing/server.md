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
import { Navigator } from "@ramonda/router";

class Account extends Component {
  private route = this.use(Navigator);
  private session = this.use(SessionConsumer);

  @mounted
  @updated
  guard() {
    if (this.session.status === "out") this.route.replace("/login");
  }

  render() {
    // This still runs, even when the guard has just asked for a redirect.
    if (this.session.status !== "in") return null;
    return <h1>{this.session.user.name}</h1>;
  }
}
```

`SessionConsumer` is your own [context](/composition/context) — one place decides who is
signed in and publishes the answer, and every page reads it. What matters is that reading
it is instant: no `await`, no request. The next section is why, and it is also why the
guard carries both decorators.

`@mounted` runs on both sides (it's `shared`), which is what makes this work on the very
first load. On the client the `replace` is an ordinary navigation. On the server there
is no history to change and no client to re-render for, so the render instead **signals
a redirect**: `renderToString` throws a `ServerRedirect`, and the server answers with a
302 to `/login`. The browser then requests `/login` and gets the right page — rather
than being handed the account page for a URL it isn't allowed to see.

### Signed in, signed out, and "not yet"

Auth has **three** states, and the third is the one that decides whether a guard works.
Most real apps have a moment on startup where the token has not been checked yet — so
`user` is not a user and not `null` either, it is *unknown*.

**Treat unknown as its own answer and the page is never seen.** Redirect on a definite
"no", render your pending state on "not yet", and render the page only on "yes":

```tsx
import { Navigator } from "@ramonda/router";

class Account extends Component {
  private route = this.use(Navigator);
  private session = this.use(SessionConsumer); // { status: "pending" | "in" | "out" }

  @mounted
  @updated
  guard() {
    // Only a definite "out" is a redirect. "pending" decides nothing yet.
    if (this.session.status === "out") this.route.replace("/login");
  }

  render() {
    if (this.session.status === "pending") return <p>Checking your session…</p>;
    if (this.session.status === "out") return null;
    return <h1>{this.session.user.name}</h1>;
  }
}
```

**Both decorators, on the one method, and this is the part that is easy to get wrong.**
`@mounted` runs on the first commit and never again. So a guard that only has `@mounted` asks
its question while the answer is still `pending`, gets "don't know", and is never asked
again — and when the answer arrives, `render()` correctly refuses to build the page but
*nothing navigates*. The visitor sits on a blank page, still on the protected URL. It even
looks like it worked, because the secret is not on screen.

`@updated` runs after every commit that is not the first. Reading `this.session.status`
subscribes this component to that key, so the change from `pending` to `out` re-renders —
and that is the commit `@updated` fires on. One method, both lifecycles: the first
decision and every later one.

That also covers the case that has nothing to do with startup: a session can end while
someone is sitting on the page — a token expires, they sign out in another tab. `@mounted`
alone would never notice.

**Trust the guard alone and the page IS seen.** This is the version to avoid, and no
amount of batching saves it — the `await` releases the frame, the browser paints, and the
account page sits there until the answer comes back:

```tsx
// ✗ The account page is on screen for the whole round trip.
@mounted async guard() {
  const ok = await fetch("/api/session").then((r) => r.ok);
  if (!ok) this.route.replace("/login");
}

render() {
  return <h1>Your account</h1>; // nothing here knows the check is still running
}
```

The fix is not a faster check. It is to **decide before rendering**: validate the session
once, high up — on the server for the first load, in one place on the client afterwards —
publish the answer as [context](/composition/context), and let both the guard and
`render()` read it synchronously. `render()` then always has an answer, even when the
answer is "not yet".

### What still runs, even when the answer is instant

When the answer *is* instant, nothing is painted — the component is built, the redirect is
applied, and the visitor only ever sees `/login`. The reason is worth knowing: **one
update is one drain, not one render.** Someone clicks through to `/account`, the account
page is built and committed, its `@mounted` asks for `/login`, and that redirect is picked
up by the same drain before it returns. Both renders happen inside one microtask, and the
browser paints after microtasks.

But "not painted" is not "not run", and two things follow from the running:

**`render()` has to be safe for a visitor who is not allowed here.** It runs before the
redirect lands, so `this.session.user.name` on a signed-out visitor throws instead of
redirecting — and a thrown render is not a redirect, it is a broken page. That is why the
examples above check `status` rather than trusting the guard.

**Any other `@mounted` on the component runs too.** A `fetch("/api/account")` in a second
`@mounted` fires for the visitor you are turning away. Put per-page loading behind the same
answer the guard uses, or accept the wasted request and the 401.

### Hydration is the case that picks the lifecycle

`@mounted` is `shared`, and on hydration it **re-runs** on the client. `@created` is
`shared` too, but on hydration it is **skipped** — the server already ran it and the
state it wrote was restored from the page.

That matters here for the exact reason described above: a cached page, or a CDN serving
one file for many paths, can put markup in front of someone the server never checked. A
guard in `@mounted` fires on that hydration. A guard in a plain `@created` does not.

So: **guard in `@mounted`**. `@created` runs earlier on a client navigation — before
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
  `@created({ env: "client" })`.

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
