---
title: mounted
description: Run a method once a component is built and committed — the first moment it can reach the page, and where a server render fetches what it needs.
section: Reference
order: 128
---

# `@mounted`

Runs **once per component**, after that component has been built and committed.

In the browser that is the first moment it can reach the real page — focus an input, measure an
element, hand a node to a library that wants one. On the server, where there is no page to reach,
it is the moment a component is finished enough to fetch what it needs. Both are below; the browser
one is the one to meet first.

## The situation it is for

A dialog that opens with the cursor already in its first field. Nothing about that can be decided
while rendering — the input does not exist yet, and `focus()` on nothing does nothing:

```tsx
import { createRef } from "@ramonda/core";

class RenameDialog extends Component {
  private box = createRef<HTMLInputElement>();

  @mounted
  takeFocus() {
    this.box.current?.focus();
  }

  render() {
    return (
      <label>
        New name
        <input ref={this.box} />
      </label>
    );
  }
}
```

The ref is empty while the render runs and holds the element by the time `@mounted` does. That gap
is the whole reason this moment exists.

**Children mount before their parent.** By the time a parent's `@mounted` runs, everything inside it
is already on the page — so a parent measuring its children finds them there.

## It runs on the SERVER too

This is the half of `@mounted` that is easy to miss, and the one most worth knowing. A server render
has no DOM and no page — but it still **builds** every component, and a shared `@mounted` runs there
as well as in the browser. `env` is what chooses:

```tsx
@mounted
both() {} // server AND client — the default

@mounted({ env: "client" })
onlyHere() {} // the browser only: focus, measure, reach the page
```

The method is handed the side it is on, so one can branch rather than two declaring opposites.

### Returning a promise makes the server wait

An `async @mounted` is **awaited on the server** — which is how a page is rendered with its data
already in it, and there is no separate API for it:

```tsx
class Profile extends Component<{ id: string }> {
  @state user: { name: string } | null = null;

  @mounted
  async load() {
    if (this.user) return; // the server already fetched it
    this.user = await getUser(this.props.id);
  }

  render() {
    return <article>{this.user?.name ?? "…"}</article>;
  }
}
```

On the **client** the same promise is fire-and-forget: a live page should paint before the data
arrives, so nothing waits.

That `if` is the one line the shape needs. The method runs on both sides, so without it the browser
would fetch again — and it does not need a framework flag, because whatever the server fetched is in
`@state`, travels in the hydration blob, and is restored **before** any client lifecycle runs. Only
the component knows what "already fetched" means.

See [Async work on the server](/ssr/async) for the whole picture.

## Anything reaching the page belongs in `env: "client"`

The example at the top of this page has no `env` and does not need one: `this.box.current` is
`null` on the server, so `?.focus()` does nothing there. Where a method would **throw** on the
server rather than quietly do nothing — anything touching `window`, `document` or a measurement —
say `env: "client"` and it is never called there at all.

## More than one, and on a hook

A class may declare several, and they run **in the order they are written**. `@mounted` also works
on a [hook](/hooks), where it runs when the component holding the hook mounts.

## What it refuses

**Anything but a method.**

## What it costs, and when not to reach for it

It runs after the DOM is committed, so anything it writes to state causes a **second** render. That
is correct for a measurement — you cannot know a width before there is a box — and wasteful for a
value you could have derived. If the answer does not need the page,
[`@created`](/reference/decorators/created) or a [`@compute`](/reference/decorators/compute) gets it
without the extra pass.

An `async` one that rejects with nothing to catch it is reported as
[`RMD059`](/reference/diagnostics/rmd059).

## Next

- [Lifecycle](/concepts/lifecycle) — all four moments, in order.
- [Refs](/concepts/refs) — how to hold the element this reaches for.
- [`@updated`](/reference/decorators/updated) — every commit after this one.
