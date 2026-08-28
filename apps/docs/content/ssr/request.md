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

class Account extends Component {
  @state name = "";
  @created init() {
    this.name = requestContext().get(currentUser)?.name ?? "guest";
  }
  render() {
    return (
      <main>
        <h1>Welcome, {this.name}</h1>
      </main>
    );
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

Values already resolved before the render starts go straight to `renderToString`, and they are
keyed **by the key itself**:

```tsx
const html = await renderToString(<App />, {
  request: {
    url: new URL(req.url ?? "/", "https://example.com"),
    cookies: new Map([["session", req.headers.cookie ?? ""]]),
    values: [[currentUser, await resolveUser(req)]],
  },
});
```

Naming the key rather than its label is what keeps the two sides of the slot together. A label
written twice — once where the slot is declared, once where the server fills it — is two strings
with nothing relating them, and a mismatch reads as "this visitor has no user", which is a real
answer for an anonymous visitor and therefore indistinguishable from a typo. With the key there is
no second spelling to get wrong.

Seed as many as the page needs — the pairs are checked one by one, so each value is checked against
its own key:

```tsx
values: [
  [currentUser, await resolveUser(req)],
  [role, "admin"],
  [seats, 3],
],
```

`seedRequest` is the door for anything resolved once the render is already under way; it takes the
same key, and ties the value's type to it.

## Read it synchronously

`requestContext()`'s per-request values are available during the render's **synchronous** work
— in `render()`, in `@created`, or at the top of a `@mounted` before its first `await`. That is
the natural place anyway: you read the user, *then* fetch. Read it after an `await` and it is no
longer in scope.

The idiomatic shape needs nothing more: **read the request in `@created`, store what you need in
`@state`.** On the server that runs and the value lands in the HTML; on the client, `@created` is
skipped and the `@state` is restored from the page — so the browser never re-reads the request,
and there is no mismatch.

Taking the object early is not a way around it. Every member of what `requestContext()` returns is a
getter over the *current* request, so this is the same late read:

```tsx
const context = requestContext(); // in time
await fetchPosts();
context.get(currentUser); // too late
```

Why it is cleared that early, since a page is one request and this looks like caution for its own
sake: it is **one** value, shared by every request the server is rendering at once. The synchronous
section runs to completion with nothing able to interrupt it, and that is what stops one visitor's
render from reading another visitor's user. Reading synchronously is what makes the shared value
safe.

Two things say so when you break it. [`RMD053`](/reference/diagnostics) reports the read when the
line runs — and it reports as well as throwing, because inside an async `@mounted` the throw goes
into the server's work drain and is swallowed, so the page would otherwise be served complete and
quietly missing the value. [`ramonda-check`](/reference/check) reports it from the source, before
anything runs at all.

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

**Most pages need none of this**, because of the `@created` → `@state` shape above: the value is
already in the page as state. Reach for `exposeToClient` when several components read the same
value directly from the context.

**A read that only ever runs in the browser is caught before the app is opened.** `RMD025` fires when
the line runs, and a line in a click handler runs only when someone clicks — so the page ships, and a
static build cannot help either: the read never happens during the render, so nothing blocks the bake.
[`ramonda-check`](/reference/check)'s `client-only-request-read` reads it off the source instead. It
reports a `cookies` or `headers` read, or a key that did not opt in, from anywhere that cannot run on
the server — an `@onWindow`, `@interval` or `@timeout` method, an `@updated`, a
`@deferHydration`, a lifecycle written `{ env: "client" }`, or a JSX event handler. A `shared`
lifecycle is not one of those and is never reported: `@created` and `@mounted` run on both sides, which
is what makes the shape above the answer.

## Telling a phone from a desktop

**Nothing in the first request tells you the screen size.** Not the user agent — that is a string the
browser chooses, every browser lies in it for compatibility, and Chrome is deliberately *reducing* what
it contains. Client hints (`Accept-CH: Sec-CH-Viewport-Width`) need a round trip before the browser starts
sending them, and a cookie written by the page needs a previous visit. On a single-page app the first
request is the *only* document request, so neither ever arrives.

So this is not a question of how to find out. It is a question of **what to render while you do not
know**, and there are three answers.

| the two versions differ in… | do this | what it costs |
|---|---|---|
| **layout** — same data, same components | **CSS**: container queries, or a media query | nothing. Right when someone resizes, and the page can stay [static](/ssr/modes) |
| **components** — different markup, different data | **defer**: send a layout-neutral shell, decide on the client after mount | a placeholder for one frame |
| components, and a placeholder is worse than being wrong | **guess** from the user agent, and accept that a wrong guess is permanent | see below |

**Reach for CSS first, and further than feels natural.** Container queries style an element by *its
container's* size, so a component adapts without anyone knowing the viewport at all — no guess, no
server/client split, no flicker. Most "different on mobile" is layout wearing a disguise.

### Deferring, and why it is usually the answer

When the two really are different components, render neither on the server:

```tsx
class Panel extends Component {
  @state private narrow: boolean | undefined = undefined;

  @mounted({ env: "client" }) measure() {
    this.narrow = window.matchMedia("(max-width: 600px)").matches;
  }

  render() {
    if (this.narrow === undefined) return <Skeleton />;
    return this.narrow ? <Cards /> : <Table />;
  }
}
```

The server sends the skeleton, the browser measures the real window, and the right branch arrives a tick
later. Nobody ever sees the wrong one — and `matchMedia` is a fact, where the user agent is a guess.

### Guessing, and exactly what it costs

```tsx
class Page extends Component {
  // Serialised with the page, so the browser reads back what the server decided.
  @state private phone = false;

  @created({ env: "server" }) read() {
    this.phone = /Mobi|Android|iPhone/i.test(requestContext().headers.get("user-agent") ?? "");
  }

  render() {
    return this.phone ? <Cards /> : <Table />;
  }
}
```

This is the shape to use *if* you guess, and the reason is real: headers do not exist in the browser, so
reading one during hydration returns nothing and the branch would flip. `@state` is serialised, so the
client reads back what the server decided and hydration agrees.

**But understand what "agrees" buys you.** Measured: with a desktop user agent and a phone browser, the
server sends the table, the phone shows the table after hydration, and **nothing is reported at all**.
Hydration agrees — on the wrong answer, permanently, because the decision is frozen into the page. The
version that reads the window inside `render()` instead ends up *correct* and is reported as
[`RMD007`](/reference/diagnostics#rmd007-server-and-client-rendered-different-output), at the cost of a
flicker. So the trade is **flickers-but-right against silent-and-possibly-wrong-for-ever**, and it is
worth choosing on purpose.

It also makes the route per-request: the header is part of who is asking, so a build cannot know it, and
reading one during a static build throws rather than baking one visitor's answer for everybody.

### If you guess, guess mobile

A default only ever serves the visitors you could **not** identify — and that population is not your
audience. It is bots, in-app webviews (which *are* phones, and carry the strangest user agents), privacy
browsers, anything with a reduced UA. Today an unrecognised string falls through to "desktop", which puts
every uncertain visitor on the expensive side of the mistake.

Because the mistake is not symmetric. Wrong towards mobile is a narrow column on a wide screen: plain, and
completely usable. Wrong towards desktop is a wide table on a 380px phone: horizontal scrolling, tap
targets too small to hit. Mobile also sends less, and when it is wrong the correction lands on the faster
device.

Your audience changes how *often* you are wrong. It does not change which mistake is worse — and a default
is chosen by cost, not by frequency. The one real exception is an app that does not work on a phone at
all, and that wants a message rather than a default.

And if you deferred, this section barely applies: the "default" is what the skeleton looks like, and a
narrow skeleton fits everywhere.

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
