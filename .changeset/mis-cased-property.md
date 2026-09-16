---
"@ramonda/css": patch
---

A property name in the wrong case is one spelling of correct CSS, not a typo.

`COLOR: red` was reported as *`COLOR` is not a CSS property*, with no suggestion — and measured in
Chromium, Firefox and WebKit, all three set `color` to red and all three say
`CSS.supports("COLOR", "red")` is true. Property names are case-insensitive in CSS.

The rule for a value's keywords already settled this — *saying it does not exist is a lie the author
cannot act on* — and reached the verdict this now uses: still refused, under `non-canonical-spelling`,
because a repository wants one spelling and `ramonda-css format` writes it.

A real typo shouted gets its suggestion back too: `DSIPLAY` is six substitutions from `display` and
none from `dsiplay`, so it used to come back with none at all.
