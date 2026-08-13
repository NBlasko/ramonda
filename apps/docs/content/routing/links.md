---
title: Links
description: Move between pages with a real anchor that navigates instantly on a plain click.
section: Routing
order: 71
---

# Links

To let people move between pages, use `<Anchor>`:

```tsx
import { Anchor } from "@ramonda/router";

<Anchor href="/players/9" className="navlink">Player 9</Anchor>;
```

`href` here is any string. If you built your routes with
[`createRouter`](/routing#links-are-type-checked-against-your-routes), the kit hands you a `Link` that is the same
component with its `href` checked against your table — a typo stops compiling instead of leading
nowhere. Reach for `Anchor` when the code does not know the app's routes, which is mostly library
code; reach for the kit's `Link` everywhere else.

A plain left click navigates instantly — no page reload — and everything else about it
behaves like a normal link.

## It's a real `<a href>`

`Anchor` renders an actual anchor, not a `<span>` with a click handler, and that
matters:

- **⌘/Ctrl-click and middle-click** open a new tab (the browser handles them);
- **right-click → copy link address** works;
- **search engines follow it**, which is much of how a site gets found;
- **hovering shows the destination** in the status bar.

A plain left click is caught and routed through the router (instant); anything else is
left to the browser.

## Props

- `replace` — replace the history entry instead of adding one.
- `scroll` — scroll to the top after navigating. Defaults to `true` (a link is a real
  navigation); pass `scroll={false}` for a link that swaps a view in place, like tabs
  partway down a long page.

## What it leaves to the browser

`Anchor` does not intercept:

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

Rule of thumb: if a person should be able to open it in a new tab, it is an `<Anchor>`.
If it is a consequence of something else, it is `push`.

## Next

- [Params, query and hash](/routing/params) — reading the URL.
