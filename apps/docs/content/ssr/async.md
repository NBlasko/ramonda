---
title: Async on the server
description: The server waits for what your lifecycle started, and hydration does not destroy it.
section: Server rendering
order: 94
---

# Async work on the server

```tsx
export class Profile extends Component<{ id: string }> {
  @state user: User | undefined;

  @mount async load() {
    if (this.user) return;          // restored from the server
    this.user = await getUser(this.props.id);
  }

  render() {
    return <article>{this.user?.name ?? "…"}</article>;
  }
}
```

`renderToString` waits for that fetch before serializing, so the name is in the HTML.

## The trigger is just a returned promise

There is no new API. A lifecycle method that returns a promise has it awaited — **on the server
only**. `async @mount` already returns one.

The asymmetry is deliberate. A server render is a request with a deadline and a single output; a
client render is a live page that must paint before the data arrives, so there it stays
fire-and-forget.

## `@mount` runs on both sides — the blob is the memo

A shared `@mount` runs on the server **and** on the client. Fetching is what `@mount` is for, and
the server render is when the data is fetched; skipping it on the client would mean a client-only
navigation never fetches at all.

So it would fetch twice — except that whatever the server fetched is in `@state`, serialized, and
restored **before** any client lifecycle runs. The guard is one line:

```tsx
if (this.user) return;
```

That is deliberately not hidden behind a framework flag. Every "run once across a process
boundary" abstraction has to answer *what counts as already done*, and only the component knows.

## The drain is bounded

Waiting once is not enough: a resolved fetch writes state, which schedules a render, which builds
components whose own `@mount`s fetch again. The server alternates — settle renders, take the new
work, await it, commit — until a round produces nothing new.

**Ten rounds, then it throws.** Much smaller than the framework's render-loop bounds, because
these are *network round trips*. A page needing ten sequential ones has a waterfall — a request
whose response decides the next — and that is a problem to surface, not to absorb into a response
time nobody can explain.

One failed fetch does not cost the page: the work is awaited with `allSettled`, so a component
that failed renders its own failure and everything else renders normally.

## Hydration does not destroy what the server rendered

The other half. A component whose output depends on something not there yet — the classic case is
`AsyncLoad` with a cold module cache — would render a fallback on the client, disagree with the
server's markup, and hydration would **replace** it. The reader watches finished content collapse
into a spinner.

`@deferHydration` inverts that:

```tsx
export class Panel extends Component {
  @deferHydration
  waitForChunk() {
    if (alreadyLoaded) return undefined;   // hydrate now
    return this.load();
  }
}
```

Return a promise and the client adopts this component's host and **leaves everything inside it
exactly as the server wrote it** — no render, no comparison, no replacement — until the promise
settles. Then the ordinary hydration path runs against those untouched nodes.

The rest of the page hydrates immediately; only this subtree waits. Updates to it are refused
until it resumes, because a render there would diff against markup the diff does not know — but
props that change meanwhile are picked up on resume, not lost.

A promise that never settles leaves the content on screen, non-interactive. That is the best
available failure, and it is silent, so development reports it as `RMD017`.

`AsyncLoad` uses this for you. You need `@deferHydration` only when you write something with the
same shape.

## Next

- [Client, server, shared](/ssr/env).
