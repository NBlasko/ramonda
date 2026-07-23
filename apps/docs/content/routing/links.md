---
title: Links
description: Link renders a real anchor and intercepts only the clicks it should.
section: Routing
order: 81
---

# Links

```tsx
import { Link } from "@ramonda/router";

<Link href="/players/9" className="navlink">Player 9</Link>
```

## It renders a real `<a href>`

Not a `<span>` with a click handler, and this matters more than it sounds:

- **middle click and ⌘/Ctrl-click** open a new tab, because the browser handles them;
- **right click → copy link address** works;
- **crawlers follow it**, which is most of how a site is discovered;
- **the status bar shows the destination** on hover, which is what tells a person where they are
  about to go.

A plain left click is intercepted and routed through the store, so navigation is instant. Anything
else is left to the browser.

## What is not intercepted

- a click with a modifier key, or any button other than the primary one;
- `target="_blank"` or a `download` attribute;
- an external URL — a different origin is a different app;
- a click something else has already called `preventDefault()` on.

## The rendered href is the one a click follows

`href` is sanitized before it is rendered — a value that is not a safe same-origin path falls back
to `/`. **The click handler reads the rendered value, not the prop.**

That sounds obvious and was once a real bug: the handler read the raw prop while the anchor showed
the sanitized one, so a middle click went to `/` and a left click went somewhere else entirely.
The same link meant two different things depending on how it was clicked.

If you take one thing from this page: a link's destination should be knowable from the markup,
because that is what every other consumer of a link reads.

## Navigating from code

```tsx
export class SaveButton extends Component {
  route = this.use(RouteHook);

  async save() {
    await this.props.onSave();
    this.route.push("/done");
  }
}
```

See [navigating](/routing/navigating). Use `<Link>` whenever the thing is a link — a person
should be able to open it in a new tab.

## Next

- [Params, query and hash](/routing/params) — reading the URL.
