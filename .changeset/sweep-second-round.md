---
"@ramonda/css": minor
"create-ramonda": patch
---

A second, wider sweep of damaged CSS — 2495 cases against Chromium, Firefox and WebKit — found 24 more that every engine drops and nothing reported:

- `unknown-selector` reads a selector's own selectors: `&:not(:first-chil)`, `&:has(> img:hovr)`. Inside `:is()` and `:where()`, which keep the rule and skip the part, the message says the part never matches.
- `malformed-selector`: an attribute flag other than `i` or `s` — `[data-state="open" ix]`.
- `malformed-container-condition`: a word after the first condition is no container name — `(a) andx (b)` — and a value of several words may lose its `:` too.
- `invalid-value`: an OpenType tag is exactly four ASCII characters (`font-feature-settings`, `font-variation-settings`), and a comma is left out only where every part before it, or after it, is — `cursor: url(a.cur) pointer` needs its comma.
- `supports-never-true`: `font-format()` and `font-tech()` names, a word one letter from one the property has — `linear-gradient(redx, blue)` — and a value made only of the property's own words that its grammar refuses.

A new project's `@ramonda/css` range moves to this release.
