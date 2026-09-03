---
title: Portal
description: Render a subtree into a DOM element somewhere else — a modal root, a toast layer — while its state, lifecycle and context stay where you wrote it.
section: Composition
order: 55
---

# Portal

`Portal` renders a subtree into a DOM element **somewhere else** — a modal root at the end of
`<body>`, a toast container, a tooltip layer — while the subtree stays part of the component that
declared it. Its lifecycle, state and context all belong where you wrote it; only the DOM lands in
the target.

**For a page's `<title>` and `<meta>`, reach for [`Head`](/ssr/head) instead.** It is built on this
hook and does the work a portal into `document.head` would leave to you: the tags are kept unique by
their identity, collected on the server, and adopted on the client rather than written twice. This
page uses the head to explain the mechanism, and every time it does, `Head` is what to use.

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

**If the target may not exist yet, read it from state.** The lookup above is right when the container
is in your `index.html`, because it is there before the app starts. When it is not — a toast layer
mounted on first use, a modal root a route brings in — a portal placed once with `null` places
nothing, and a factory that read no signal is never asked again:

```tsx
class Toast extends Component {
  @state root: Element | null = null;                 // a signal, so the factory re-runs

  portal = this.use(Portal, (self: Toast) => ({
    children: <div className="toast">saved</div>,
    target: self.root as Element,
  }));
}
```

Nothing is placed while `root` is `null`, nothing is reported — an absent target is a state, not a
mistake — and the children go in on the render where it first has one. Written as
`document.getElementById("toast-root")!` with nothing reactive around it, the portal would place
nothing and never try again.

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

## `list()` works here

A portal's children go through the real reconciler, so a list is a list — minted identity,
per-item scopes, the whole-list skip. Nothing about it is special because it is portalled:

```tsx expect-report:row-without-a-key
this.use(Portal, () => ({
  children: list(this.rows, (item) => <Row item={item} />),
  target: modals,
}));
```

Reordering moves each row's node, with the component state on it, rather than a neighbour
taking its contents. There is no key to write — see [lists](/lists).

## Events follow the DOM, not where you wrote it

There is no synthetic event layer — a handler in the markup is a real listener on a real node —
so a portalled subtree's events bubble through the DOM, from the **target's** ancestors,
not from the component that declared the portal. A handler on an ancestor of the portal's
owner will **not** see them. Put the handler on the portalled content itself, or on an
ancestor of the target.

## Server rendering

A portal into `document.head` is collected on the server and adopted on the client, so its tags are
in the served HTML and are not duplicated on hydration. That is exactly how [`Head`](/ssr/head) puts
a page's `<title>` and `<meta>` into the document — it is a portal into the head with the tags kept
unique by their identity.

Which is to say: this paragraph describes how `Head` works, not something to build. Writing metadata
through a raw portal means keeping the tags unique yourself, and two pages that both set a
description would each add one.

A **component** inside a portal is hydrated like any other: its host is adopted and its
server state restored, not rebuilt from its initial values.

### A target outside the app — `portalTarget`

`document.head` works because the server's document has one. Every other container — a modal
root in the body — does not exist during a server render: your shell is assembled *after* the
render returns, so there is no element to point at. Name it instead:

```tsx
import { portalTarget } from "@ramonda/core";

const modals = portalTarget("modals");

this.use(Portal, () => ({ children: <Dialog />, target: modals }));
```

The server collects that target's content and hands it back on `page.portals`, keyed by the
name — from `renderPage` for a per-request render and from `renderStatic` for a baked one.
[`renderDocument`](/ssr/render) emits a container per entry, after the app root, so a modal is
outside the stacking context it is trying to escape.

If you assemble your own shell, mark where they go and `fillDocument` fills it:

```html
<div id="app"><!--ssr--></div>
<!--portals-->
```

```js
res.end(fillDocument({ template, html, title, head, portals }));
```

A shell that collected blocks and has no `<!--portals-->` is refused, naming the targets. That
one is not a quiet failure on purpose: a page missing its app announces itself, while a dropped
portal renders a page that looks correct and then builds the subtree a second time in the browser.

On the client the name resolves to that container, and the block inside it is adopted rather
than built again. With no server render at all — a client-only app — the container is created
on demand, so a portal is not a feature that only works on server-rendered pages.

A target **inside** your own render stays an ordinary element: you have the node, and that is
the "inline" case above.

## Next

- [Head and metadata](/ssr/head) — the portal you will reach for most.

A portal is one of three ways to affect the page outside your own subtree — see
[reaching the document](/composition/document) for which to reach for when.
