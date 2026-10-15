---
title: Head and metadata
description: Give each page its own title and description, from the component that knows them.
section: Server rendering
order: 82
---

# Head and metadata

Each page needs its own `<title>` and description — they are what shows in a browser
tab and in a search result, and they decide whether anyone clicks. Set them with the
`Head` hook, in the component that knows them:

```tsx
import { Head } from "@ramonda/core";

export class StateGuide extends Component {
  head = this.use(Head, () => ({
    title: "State — Ramonda",
    description: "How @state turns a class field into a signal.",
  }));

  render() {
    return <article>…</article>;
  }
}
```

When you render on the server, `renderPage` returns them next to the body:

```ts
const page = await renderPage(<App />);
// { body, title, head, lang, dir }
```

## Why a hook

Because the component that knows the title is usually the *leaf* — the specific page —
not the shell around it. As a hook, `Head` composes the way the tree does: a layout
can set a default title, and a route inside it can override it, and the deeper one
wins.

And two `Head`s that are **both live at once** — a sidebar with its own `<meta>` and the
route with its title — both contribute: different tags coexist, and only a genuine
conflict (both set the title) is resolved, in favour of the deeper one. `Head` writes into
one `<head>` the way many [portals](/composition/portal) share one target.

## What you can set — `HeadOptions`

| | |
|---|---|
| `title` | the `<title>` |
| `description` | `<meta name="description">` — the snippet under the title in a result |
| `meta` | anything else: Open Graph, Twitter cards, robots, viewport |
| `link` | canonical URLs, alternates, icons, preloads |
| `lang` | `<html lang>` — the language the page is in |
| `dir` | `<html dir>` — `"ltr"`, `"rtl"` or `"auto"`; any string compiles, so `cond ? "rtl" : "ltr"` needs no annotation |

`meta` takes `MetaTag`s and `link` takes `LinkTag`s — a `<link>` is identified by its `rel` plus its
`href`, and carries `type`, `sizes`, `crossOrigin` and `hreflang` where they apply.

There is no `robots` or `canonical` key — those are a `meta` and a `link`. A key `Head` does not take
compiles and is ignored, because the options come back from a callback; write the callback as
`(): HeadOptions => ({ … })` and it is refused where it is written. See [a misspelt option is not a
type error](/hooks#a-misspelt-option-is-not-a-type-error).

`title` and `description` come first because they are the two that decide clicks.
**Set them on every page** — a site whose pages all share one title competes with
itself.

## Reactive

The callback form follows a value:

```tsx
head = this.use(Head, (self: Page) => ({ title: `${self.section} — Ramonda` }));
```

## The page's language — `lang` and `dir`

A screen reader picks its pronunciation from `<html lang>`, and a browser its hyphenation and
spell-check. Set it where the language is decided, usually the app root, from the reader's choice:

```tsx
import { Component, Head, state } from "@ramonda/core";

export class App extends Component {
  @state locale = "sr";

  head = this.use(Head, (self: App) => ({
    lang: self.locale,
    dir: self.locale === "ar" ? "rtl" : "ltr",
  }));

  english() {
    this.locale = "en";
  }

  render() {
    return <button onclick={this.english}>English</button>;
  }
}
```

It follows the rules the title does. The deeper `Head` wins, so a page in another language can say
so. When the page goes away, `<html>` gets back what it had, unless something else changed it since.

On the server, `renderPage` returns `lang` and `dir`, and [`fillDocument`](/ssr/server) writes them
over the shell's `<html lang="en">`. Pass them through, as you pass `title`. A page that set neither
leaves the shell's value standing.

## Each `<meta>` needs an identifier — `MetaTag`

```tsx
meta: [{ property: "og:type", content: "article" }]   // ✓
meta: [{ content: "no key" }]                          // ✗ type error
```

One of `name` / `property` / `httpEquiv` identifies a tag, so an update can find and
replace it rather than appending another copy. On hydration, the browser updates the
server's tags in place.

## Next

- [Building a static site](/ssr/static).
