---
title: Head and metadata
description: Per-page title and description, from the component that knows them.
section: Server rendering
order: 92
---

# Head and metadata

```tsx
import { Head } from "@ramonda/core";

export class StateGuide extends Component {
  head = this.use(Head, {
    title: "State — Ramonda",
    description: "How @state turns a class field into a signal.",
  });

  render() {
    return <article>…</article>;
  }
}
```

`renderPage` returns them alongside the body:

```ts
const page = await renderPage(<App />);
// { body, title, head }
```

## Why a hook

Because **the component that knows the title is the leaf**, not the shell.

A decorator would fix the value at class-definition time, so a title could never contain anything
the page computed. An option on `renderToString` would only let the top of the tree speak.

As a hook it composes the way the tree does: a layout sets a default, a route inside it overrides
the title, and the deeper one wins.

## Options

| | |
|---|---|
| `title` | the `<title>` |
| `description` | `<meta name="description">` — the snippet under the title in a result |
| `meta` | anything else: Open Graph, Twitter cards, robots, viewport |
| `link` | canonical URLs, alternates, icons, preloads |

`title` and `description` are first class because they are the two that decide whether anyone
clicks. **Set them on every page.** A site whose pages all carry one title competes with itself.

## Reactive

```tsx
head = this.use(Head, (self: Page) => ({ title: `${self.section} — Ramonda` }));
```

The callback form follows the value.

## It works on both sides through one code path

`Head` writes to `document.head`. That is the same operation on the client and on the server —
`renderToString` runs under a DOM — so there is no second implementation to keep in step.

The alternative, a module-level map of collected tags, is how most head libraries do it and is
exactly what this codebase refuses: module scope is shared by concurrent requests, so two renders
in flight would read each other's title.

## A `<meta>` must be identifiable

```tsx
meta: [{ property: "og:type", content: "article" }]   // ✓
meta: [{ content: "no key" }]                          // ✗ type error
```

Exactly one of `name` / `property` / `httpEquiv` identifies a tag, and that identity is what an
update replaces. Without it there is no way to find the tag again, so every update would append
another copy — and the failure is invisible until a page has been open long enough to accumulate
them.

## On hydration

Applying is an **upsert**. The client finds the server's tags and updates them in place rather
than doubling every one.

## Next

- [Building a static site](/ssr/static).
