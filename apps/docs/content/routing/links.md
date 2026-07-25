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

## Props

- `replace` — replace the history entry instead of adding one.
- `scroll` — scroll to the top after navigating. Defaults to `true` (a link is a real
  navigation); pass `scroll={false}` for a link that swaps a view in place, like tabs
  partway down a long page.

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
export class SaveButton extends Component {
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
