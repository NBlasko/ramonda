---
"@ramonda/check": patch
---

The `@Host` TAG callback is part of the render, as the props callback already was.

`@Host((p) => p.as ?? "div")` is a documented form core supports and re-checks on every call, so it
runs exactly as often as the props callback beside it. Every render rule reads through this walk and
every one of them was blind to it — measured with a clock read in a tag callback, on a decorator
that has no second argument at all.

Found by being asked what happens when `@Host`'s first argument is not a string literal. The other
half of that question — a tag reached through a name, `@Host(myHost)` — has no consumer yet: nothing
in the package reads the host TAG, only whether the decorator is there.

Also walks `link-without-a-destination` through the checklist. It holds on all four spellings it
claims, on their shouted and whitespaced variants, and on a destination one name away; the three
correct shapes stay silent. What the walk added is the reasoning for the one silence that looks like
an oversight: an anchor a component makes through `@Host` — the router's own `Link` — has no `<a>` in
any JSX to read, and its `href` is a getter over props AND router state. Judging it would be
guessing, so `packages/router` is silent there and correctly so.
