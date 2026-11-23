---
title: Reaching the document
description: How a component affects the page outside its own subtree — a class it already renders, the Head hook, a Portal, a theme on <html>.
section: Composition
order: 56
---

# Reaching the document

A component owns its own subtree. Sometimes the thing it has to affect is not in there: the page
must not scroll behind an open drawer, the tab needs a title, a dialog belongs at the top of the
document rather than three flex containers deep.

The imperative answer is one line, and it is the wrong one:

```tsx expect-report
@mounted lock() {
  document.documentElement.classList.add("nav-locked"); // ✗
}
```

It is a **second copy of state you already hold**. `menuOpen` is the truth; the class is a
duplicate that has to be kept in step by hand, removed when the component goes away, and remembered
by whoever adds the next handler that touches the same state. [`ramonda-check`](/reference/check)
reports it.

Sort the answer by *what is being set*.

## Styling that depends on state → a class you already render

Render the class where the state lives, and let the stylesheet reach up:

```tsx
render() {
  return <div className={this.menuOpen ? "body nav-open" : "body"}>{this.props.children}</div>;
}
```

```css
html:has(.body.nav-open),
html:has(.body.nav-open) body {
  overflow: hidden;
}
```

`:has()` is what lets the document act on a class held by a descendant. Nothing writes to
`documentElement`, so there is no second copy to keep in step, no cleanup to forget, and no class
left behind when the component unmounts.

**Lead with the server, because that is the argument that decides it.** The class is in the markup
the server sends, so the page is right on the first paint. An imperative write cannot be: it lands
after hydration, so there is always a moment of the wrong thing on screen — a scrollbar that
appears and vanishes, a flash of the light theme.

This is what the documentation site itself ships for its drawer.

`:has()` is Chrome 105, Safari 15.4, Firefox 121. Below that the rule simply does not apply, which
is worth choosing deliberately: the drawer still opens and closes, the page behind it just moves as
it did before.

## Tags in `<head>` → the `Head` hook

Title, description, canonical, Open Graph. [`Head`](/ssr/head) is the proven shape for reaching
outside your subtree reactively, through one code path on the server and the client:

```tsx
private head = this.use(Head, (self: Article) => ({ title: self.post.title }));
```

## Content that must live elsewhere in the DOM → `Portal`

A dialog, a toast, a tooltip that must escape an `overflow: hidden` ancestor.
[`Portal`](/composition/portal) renders it into a container outside your root while keeping it in
your component tree — so context still reaches it and it is destroyed with its owner.

## The page's language on `<html>` → `Head`

`lang="sr"` and `dir="rtl"` are set by [`Head`](/ssr/head#the-pages-language-lang-and-dir), the same
way as the title, on the server and the client:

```tsx
private head = this.use(Head, (self: App) => ({ lang: self.locale }));
```

## A theme on `<html>` → `Head`'s `data`

`data-theme="dark"`, `data-density="compact"` — set by [`Head`](/ssr/head#a-theme-on-html-data), on
the server and the client, by `lang`'s rules:

```tsx
private head = this.use(Head, (self: App) => ({ data: { theme: self.theme } }));
```

`<html>` takes `data-*` and nothing else from a component. A class there would be a second way to
say the same thing; `<body>` and an inline `style` on either have no case yet that a `data-*` on
`<html>` and a selector do not cover. A write of your own in `@mounted` —
`document.body.classList.add("dark")` — is reported as [`dom-writes`](/rules/dom-writes), and the
answer is `data`, not an ignore.

## A command is not any of this

`scrollIntoView()`, `focus()`, `select()`, `getBoundingClientRect()` — these tell the browser to
*do* something. They have no declarative form, nothing is duplicated by calling them, and they are
never reported. Reach for a [`ref`](/concepts/refs) and call them.

The line is not "never touch the DOM". It is that **rendering** done imperatively is a second copy
of state, and a command is not.

## Next

- [Portal](/composition/portal) — the mechanism this page keeps pointing at, in full.
- [Head and metadata](/ssr/head) — the one case worth using instead of a portal into `<head>`.
- [Composition](/composition) — the other five ways components fit together.
