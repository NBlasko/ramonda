---
title: Refs
description: Reach the real element on the page — to focus it, measure it, or hand it to a library.
section: Lifecycle and subscriptions
order: 35
---

# Refs

Sometimes you need the actual element on the page — to focus an input, measure
something, scroll it, or hand it to a library that wants a real node (a chart, an
editor, a map). A **ref** gives you that node.

```tsx
import { createRef } from "@ramonda/core";

export class SearchBox extends Component {
  private input = createRef<HTMLInputElement>();

  focusIt() {
    this.input.current?.focus();
  }

  render() {
    return <input ref={this.input} type="search" />;
  }
}
```

```demo:RefFocus
```

## `current` is empty until the element exists

`this.input.current` is `null` until the element is on the page. So reach for it from
an event handler or from `@mounted` — never from `render()`, where the element doesn't
exist yet.

```tsx
@mounted
ready() {
  this.input.current?.focus();
}
```

## Not for changing what's on screen

A ref is for things state can't express. Don't use it to read or rewrite what the
component shows — that is [state](/concepts/state)'s job, and the next render would
overwrite whatever you changed by hand anyway.

## On a component, the ref is its host

```tsx
<Card ref={this.card} />
```

`this.card.current` is the `Card`'s [host element](/concepts/host) — there is only
one, so there is no question of *which*.

## Callback refs

`ref` also takes a function, called with the node when it appears and `null` when it
goes away:

```tsx
<div ref={(node) => node && this.observer.observe(node)} />
```

A ref is cleared when its element is removed, so it can't keep a detached node alive.

## Next

- [Hooks](/hooks) — state and lifecycle with no element at all.
