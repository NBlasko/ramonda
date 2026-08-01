---
title: Reading the request
description: Read cookies, headers, and the signed-in user with requestContext — and why doing so keeps a page out of the static build.
section: Server rendering
order: 85.5
---

# Reading the request

Some pages depend on who is asking — the signed-in user, a cookie, a header. Ramonda gives you
one way to read that per-request data, `requestContext()`, and reading it is exactly what marks
a route as [dynamic](/ssr/modes): a page that reads the request cannot be baked into a static
file, because that file would then hold one visitor's data and be served to everyone.

```tsx
import { requestContext } from "@ramonda/core";

@Host("main")
class Account extends Component {
  @state name = "";
  @create init() {
    this.name = requestContext().get(currentUser)?.name ?? "guest";
  }
  render() {
    return <h1>Welcome, {this.name}</h1>;
  }
}
```

## What it gives you

```tsx
const ctx = requestContext();
ctx.url;                       // the request URL — always safe (it is the page identity)
ctx.cookies.get("session");    // a cookie
ctx.headers.get("user-agent"); // a header
ctx.get(currentUser);          // an app-defined per-request value (below)
```

`url` is the one part that is **safe at build** — the URL is which page this is, not who is
asking, so a static build knows it. Everything else is per-request: reading it during a build
throws, which is what stops the route from being baked. (In the browser, `url` follows the address
bar, so it stays right after a client-side navigation.)

## Per-request values: `requestKey` and `seedRequest`

Cookies and headers are raw. The signed-in user is something *your server* works out — validate
the session, look up the account — and then hands to the page. Declare a typed slot once, fill
it on the server, read it in the tree:

```tsx
// shared — a typed key
export const currentUser = requestKey<{ name: string } | null>("currentUser");

// server.mjs — resolve the user and seed it, per request
seedRequest(currentUser, await resolveUser(req));

// any component — read it
const user = requestContext().get(currentUser);
```

The validation — the cookie, the database, the secret — stays on the server. The page only sees
the value you chose to seed.

## Read it synchronously

`requestContext()`'s per-request values are available during the render's **synchronous** work
— in `render()`, in `@create`, or at the top of a `@mount` before its first `await`. That is
the natural place anyway: you read the user, *then* fetch. Read it after an `await` and it is no
longer in scope.

The idiomatic shape needs nothing more: **read the request in `@create`, store what you need in
`@state`.** On the server that runs and the value lands in the HTML; on the client, `@create` is
skipped and the `@state` is restored from the page — so the browser never re-reads the request,
and there is no mismatch.

## The guard, up close

When the build prerenders a route, the request context is *poisoned*: any per-request read
throws `RequestReadDuringBuild`, and the build fails naming the route and the field:

```
✗ /account — reads the request (get("currentUser")); cannot be prerendered.
```

So you cannot accidentally bake a per-user page. A route that reads the request has to be
[dynamic](/ssr/modes) — which is the default, so usually you do nothing and it is already right.
The rule this enforces is the one that must never break: **a baked page cannot contain
per-request data.**

## In the browser: nothing travels unless you say so

`requestContext()` reads the real request on the **server**. In the browser it holds only what the
server explicitly exposed — and by default that is **nothing**.

Opt a key in when its value has to be readable from `requestContext()` on the client too:

```tsx
export const currentUser = requestKey<User | null>("currentUser", { exposeToClient: true });
```

Now the server sends that value with the page and the browser reads it back from the same
`requestContext().get(currentUser)`.

**Cookies and headers can never be exposed.** They are the server's — and an httpOnly cookie is
invisible to JavaScript anyway. Reading them in the browser (or reading a key that did not opt in)
returns nothing and reports [`RMD025`](/reference/diagnostics#rmd025-per-request-data-read-in-the-browser)
in development. It does not throw: breaking the page would be the worse outcome, and if the server
rendered a value where that read is, hydration reports the divergence too.

**Most pages need none of this**, because of the `@create` → `@state` shape above: the value is
already in the page as state. Reach for `exposeToClient` when several components read the same
value directly from the context.

## It is not a place for secrets

Whatever you expose is **published** — it sits in the page's HTML for anyone to read. Expose only
what is safe to publish: a display name, an id, a role. Never a session token, a raw cookie, or a
database record.

Keep the sensitive part on the server: validate and resolve there, expose only the display-ready
value, and let real authorization live behind an API the browser calls. `env` and this context
choose *where code runs*, not what is safe to ship — see
[client / server / shared](/ssr/env).

## Next

- [Rendering modes](/ssr/modes) — how a route picks static, dynamic, or ISR.
