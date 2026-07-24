---
title: Async on the server
description: The server waits for the data your components fetch, so it lands in the HTML.
section: Server rendering
order: 84
---

# Async work on the server

If a component fetches data when it mounts, the server waits for that fetch before
producing the HTML — so the data is in the page, not a spinner.

```tsx
export class Profile extends Component<{ id: string }> {
  @state user: User | undefined;

  @mount async load() {
    if (this.user) return; // already restored from the server
    this.user = await getUser(this.props.id);
  }

  render() {
    return <article>{this.user?.name ?? "…"}</article>;
  }
}
```

## How it knows to wait

There is no new API: a lifecycle method that returns a promise — an `async @mount`
does — is awaited, **on the server only**. On the client it stays fire-and-forget,
because a live page should paint before the data arrives.

## `@mount` runs on both sides — so guard the fetch

A shared `@mount` runs on the server (where the data is fetched) *and* on the client.
Without a guard it would fetch twice. But whatever the server fetched is in `@state`,
sent in the blob, and restored **before** any client lifecycle runs — so one line is
enough:

```tsx
if (this.user) return;
```

It isn't hidden behind a framework flag because only the component knows what "already
fetched" means.

## Failures don't sink the page

The server awaits all the in-flight work together, so one failed fetch just makes its
own component render a failure while everything else renders normally. (There is also
a limit — ten sequential rounds of fetch-triggers-fetch, then it throws, because that
many round-trips in a row is a waterfall worth surfacing.)

## Hydration doesn't destroy server-rendered content

There is a matching concern on the client: a component whose output depends on
something not ready yet — the classic case is `AsyncLoad` before its chunk has
loaded — would render a fallback, disagree with the server's HTML, and get replaced.
The reader watches finished content flash into a spinner. `@deferHydration` prevents
that: it tells hydration to leave a subtree exactly as the server wrote it until a
promise settles, then hydrate it normally. `AsyncLoad` uses it for you; you need it
yourself only if you build something with the same shape.

## Next

- [Client, server, shared](/ssr/env).
