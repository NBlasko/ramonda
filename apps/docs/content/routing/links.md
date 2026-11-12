---
title: Links
description: Move between pages with a real anchor that navigates instantly on a plain click.
section: Routing
order: 71
---

# Links

To let people move between pages, use `<Link>`:

```tsx
import { Link } from "@ramonda/router";

<Link href="/players/9" className="navlink">Player 9</Link>;
```

A plain left click navigates instantly — no page reload — and everything else about it
behaves like a normal link.

## It's a real `<a href>`

`Link` renders an actual anchor, not a `<span>` with a click handler, and that
matters:

- **⌘/Ctrl-click and middle-click** open a new tab (the browser handles them);
- **right-click → copy link address** works;
- **search engines follow it**, which is much of how a site gets found;
- **hovering shows the destination** in the status bar.

A plain left click is caught and routed through the router (instant); anything else is
left to the browser.

## A query and a hash

A path may carry a query and a hash. `push` takes the same:

```tsx
import { Link } from "@ramonda/router";

const sortedBy = (key: string) => <Link href={`/players?sort=${encodeURIComponent(key)}#top`}>By {key}</Link>;
```

The path before the `?` is checked against your route table, to the letter; what follows it is
not. A query needs at least one `key=value`. A value from data goes through `encodeURIComponent`,
so a space, an `&` or a `#` in it stays part of the value.

**A path and a query, or a `:param`?** A `:param` route — `/players/:id` — is one page per id, and
each can be [baked at build time](/routing/server) when the ids are known then. When they are not —
an id the reader created, stored only in their browser — a fixed path with the id in the query,
`/player?id=…`, is one page, baked once. The baked page has no query, so what it shows for the id
comes after the page loads: a [`clientOnly` query](/query/server#data-only-the-browser-has) keyed by
the id renders pending on the server and on the client's first render alike, and a value read
straight from the query is shown [once the page is live](/routing/server#what-the-server-never-sees).

## A path the app works out

Sometimes the app builds the path itself — the same page in the other language, say. Built as a plain
`string`, it is refused: `pathname.replace("/sr/", "/en/")` is a `string`, and a `string` could be any
path at all, which is exactly what `href` does not take.

Build it from typed parts instead, and the type can see that it is a path the table has:

```tsx
import { Component } from "@ramonda/core";
import { Link } from "@ramonda/router";

type Lang = "sr" | "en";
const PAGES = ["tournaments", "new"] as const;
type Page = (typeof PAGES)[number];

/** The same page in the other language — `/sr/new` ↔ `/en/new`. */
function inOtherLanguage(lang: Lang, page: Page) {
  return `/${lang === "sr" ? "en" : "sr"}/${page}` as const;
}

class LanguageSwitch extends Component<{ lang: Lang; page: Page }> {
  render() {
    return (
      <Link href={inOtherLanguage(this.props.lang, this.props.page)} lang={this.props.lang === "sr" ? "en" : "sr"}>
        {this.props.lang === "sr" ? "English" : "Srpski"}
      </Link>
    );
  }
}
```

`as const` keeps the result a template type, `` `/en/tournaments` | `/sr/new` | … ``, rather than a
`string`, and each of those is checked against `/:lang/tournaments` and `/:lang/new` like a path
written out. Keeping the query is the same move: append it as `` `?id=${id}` `` — a query needs at
least one `key=value`, and the type says so.

What is never needed is a way round the check: a path the parts cannot describe is a path the table
does not have.

## Props

- `replace` — replace the history entry instead of adding one.
- `scroll` — scroll to the top after navigating. Defaults to `true` (a link is a real
  navigation); pass `scroll={false}` for a link that swaps a view in place, like tabs
  partway down a long page.
- Anything else an `<a>` takes — `lang`, `hreflang`, `title`, `rel`, `target`, `aria-*`, `data-*` —
  goes onto the anchor as written: `<Link href="/en" lang="en" hreflang="en">English</Link>`.
- `onclick` runs before the link navigates. Call `event.preventDefault()` in it to stop the
  navigation — to confirm unsaved changes, say.

## What it leaves to the browser

`Link` does not intercept:

- a click with a modifier key, or a non-primary button;
- `target="_blank"` or a `download`;
- a link to another site (a different origin is a different app);
- a click something else already called `preventDefault()` on.

## Navigating from code instead

Sometimes a navigation is the result of an action, not a link someone clicks — a
redirect after saving. For that, use the router's `push` (next page):

```tsx
import { Navigator } from "@ramonda/router";

export class SaveButton extends Component<{ onSave: () => Promise<void> }> {
  route = this.use(Navigator);

  async save() {
    await this.props.onSave();
    this.route.push("/done");
  }
}
```

Rule of thumb: if a person should be able to open it in a new tab, it is a `<Link>`.
If it is a consequence of something else, it is `push`.

## Next

- [Params, query and hash](/routing/params) — reading the URL.
