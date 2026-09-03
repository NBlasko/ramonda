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
    return <input ref={this.input} type="search" aria-label="Search" />;
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

## A ref goes on an element, not on a component

A component may render one element, several, or none, so `<Card ref={…} />` has no answer
to *which* element it would mean. Put the ref inside the component, on the element that
should carry it:

```tsx
import { createRef } from "@ramonda/core";

class Card extends Component {
  private box = createRef<HTMLDivElement>();

  render() {
    return <div ref={this.box}>…</div>;
  }
}
```

If the caller is the one who needs it, take the ref as an ordinary prop and place it
where you know it belongs:

```tsx
import type { RefTarget } from "@ramonda/core";

class Card extends Component<{ box?: RefTarget<HTMLDivElement> }> {
  render() {
    return <div ref={this.props.box}>…</div>;
  }
}
```

## Callback refs

`ref` also takes a function, called with the node when it appears and `null` when it
goes away:

```tsx
import { Component, createRef } from "@ramonda/core";

class Watched extends Component {
  private observer = new IntersectionObserver(() => {});

  private box = createRef<HTMLDivElement>((node) => {
    if (node) this.observer.observe(node);
  });

  render() {
    return <div ref={this.box} />;
  }
}
```

The callback goes to `createRef`, not into the JSX. A `ref` prop takes a ref — something
that can receive the element — and a function written in the attribute would also be a new
one on every render, which
[`RMD020`](/reference/diagnostics/rmd020)
reports.

A ref is cleared when its element is removed, so it can't keep a detached node alive.

## `Ref`, `RefTarget` and `RefCallback`

`createRef` is the only one of these you call. The other two appear when a type is written by hand
— a field annotation, a function that takes a ref.

**Call `createRef` where an identity belongs** — a field, or anywhere that runs once. From a
`render()`, a `@compute`, a `@memoized` member or a hook's props callback it answers a new object
every pass: the child is handed a changed `ref` on every render, and the ref you meant to read is
replaced before you can. [`RMD061`](/reference/diagnostics/rmd061) reports it, and
[`ref-built-where-it-cannot-be-kept`](/rules/ref-built-where-it-cannot-be-kept) says the same before
it runs.

**`Ref<T>`** is what `createRef<T>()` hands back: a `current` that is the node or `null`, and the
`setCurrent` the framework calls. Annotating a field with it is the usual reason to name it —
`private input: Ref<HTMLInputElement> = createRef()`.

**`RefTarget<T>`** is what a `ref` prop accepts, and it is deliberately smaller than `Ref<T>`: only
`setCurrent`. `Ref<T>` holds a mutable `current`, which makes it invariant — a
`createRef<HTMLElement>()` would be refused on a `<p>`, because `Ref<HTMLElement>` is not a
`Ref<HTMLParagraphElement>`. Asking only for the setter is the direction that is safe: a ref that
can hold any element can certainly hold this one. Take `RefTarget<T>` when you write a component
that forwards a ref onward.

**`RefCallback<T>`** is the function `createRef` takes — `(current: T | null) => void`.

## Next

- [Hooks](/hooks) — state and lifecycle with no element at all.
