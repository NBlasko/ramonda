---
title: Portal
section: Composition
order: 55
---

# Portal

`Portal` renders a subtree into a DOM element **somewhere else** — `document.head`, a
modal root at the end of `<body>`, a toast container — while the subtree stays part of
the component that declared it. Its lifecycle, state and context all belong where you
wrote it; only the DOM lands in the target.

It is a hook, so it renders **nothing** where you declare it:

```tsx
import { Portal } from "@ramonda/core";

class Toast extends Component<{ message: string }> {
  portal = this.use(Portal, (self: Toast) => ({
    children: <div className="toast">{self.props.message}</div>,
    target: document.getElementById("toast-root")!,
  }));

  render() {
    return null;
  }
}
```

`children` is whatever an expression slot accepts — one element, a string, or an array —
and `target` is the element it renders into.

## It owns only its own nodes

Two portals into one target coexist, and neither touches what was already there: a shell
tag in `<head>`, another portal's content. When a portal unmounts it removes only what it
put there. This is the property `Head` is built on — many `Head` hooks write into one
`<head>` without fighting over it.

## Reactive children

The callback form re-renders the portalled content when the values it reads change, like
any other reactive read:

```tsx
this.use(Portal, (self) => ({
  children: <div className="sheet">{self.rows} rows</div>,
  target: document.body,
}));
```

Because a hook's callback is cached on the signals it read, an unrelated render of the
owner does not re-render the portal — only a change to what `children` actually depends on
does.

## A reactive target, and "inline"

`target` can change, and the nodes **move** — the same node, keeping its state, not a
second copy left behind:

```tsx
this.use(Portal, (self) => ({
  children: <div className="sheet">…</div>,
  target: self.wide ? document.body : self.localAnchor, // full-screen vs in place
}));
```

There is no `disabled`/inline flag: to keep the content in place, point `target` at an
element in your own render. A `target` that only becomes available after mount is placed
then, not lost.

## Keyed children reorder without losing state

Give portalled children a `key`, and reordering keeps each node — and the component state
on it — with its key, rather than a neighbour taking its contents:

```tsx
children: this.order.map((id) => <Row key={id} item={this.byId[id]} />);
```

## Events follow the DOM, not where you wrote it

There is no synthetic event layer — `@onElement` attaches a real listener to a real node —
so a portalled subtree's events bubble through the DOM, from the **target's** ancestors,
not from the component that declared the portal. A handler on an ancestor of the portal's
owner will **not** see them. Put the handler on the portalled content itself, or on an
ancestor of the target.

## Server rendering

A portal into `document.head` is collected on the server and adopted on the client, so its
tags are in the served HTML and are not duplicated on hydration. That is exactly how
[`Head`](/ssr/head) puts a page's `<title>` and `<meta>` into the document — it is a portal
into the head with the tags kept unique by their identity.

## Next

- [Head and metadata](/ssr/head) — the portal you will reach for most.
