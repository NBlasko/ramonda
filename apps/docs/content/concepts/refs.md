---
title: Refs
description: A Ref holds a real DOM node, for the things state cannot express.
section: Core concepts
order: 40
---

# Refs

A `Ref` holds a real DOM node.

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

## What it is for

Things the DOM does and state cannot express: focus, selection, scroll position, measuring, and
handing a node to a library that wants one (a chart, an editor, a map).

Not for reading or changing what the component renders. That is [state](/concepts/state) — a ref
that writes `textContent` is a value the framework does not know about, and the next render will
overwrite it.

## `current` is null until it is not

The node exists once the element is in the document. So reach for `.current` from an event
handler or from `@mount` — never from `render()`, where the element being rendered does not exist
yet.

```tsx
@mount
ready() {
  this.input.current?.focus();
}
```

## On a component, a ref is its host

```tsx
<Card ref={this.card} />
```

`this.card.current` is the `Card`'s host element. Unambiguous, because
[a component is exactly one element](/concepts/host) — there is no question of *which* one.

## Callback refs

`ref` also takes a function, called with the node when it is attached and with `null` when it is
released.

```tsx
<div ref={(node) => this.observer.observe(node)} />
```

## Cleanup

A ref is cleared when its element is unmounted, so it cannot keep a detached node alive.

## Next

- [Hooks](/concepts/hooks) — state and lifecycle with no element at all.
