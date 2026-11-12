---
"@ramonda/router": minor
"@ramonda/core": minor
---

`<Link>` passes every attribute it does not consume to its anchor — `lang`, `hreflang`, `title`, `rel`, `target`, `aria-*`, `data-*` — where the type used to refuse them. Found by the second trial: a language switch could not say `lang="en"`. An `onclick` on a `Link` runs before it navigates, and `preventDefault()` in it stops the navigation; a link with `target` (other than `_self`) or `download` is left to the browser.

`@ramonda/core` exports `forwarded(this, consumed)`, which `Select` and `Link` are built on: every prop a component does not consume, to spread onto the one element it wraps. `{...this.props}` spreads nothing, because props are read key by key.

The router now needs `@ramonda/core` 0.29 or later, for `forwarded`: update the two together. A project made by `create-ramonda` gets them together already.
