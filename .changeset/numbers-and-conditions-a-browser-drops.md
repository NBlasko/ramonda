---
"@ramonda/css": minor
---

**Four declarations a browser drops without a word are reported now.** Each was measured in
Chromium, Firefox and WebKit, and each reads a table the engines wrote:

- `number-without-a-unit` — `gap: 12`, `font-size: 16`, `margin: 4px 12`. A number with no unit where
  a length goes is dropped; zero is not reported, and a number inside a call — `repeat(3, 1fr)` — is
  left alone.
- `fraction-where-a-whole-number-goes` — `z-index: 1.5`, `column-count: 2.5`, `grid-column: 1 / 2.5`,
  and `z-index: 1.0` or `1e2` too: a whole number is a spelling, and every engine drops those. No type
  can refuse it: `number` takes `1.5`.
- `unknown-media-value` — `@media (prefers-color-scheme: drak)`, `@media (min-width: 40)` and the
  range form `@media (width >= 40)`. A value the feature does not have is kept and never matches; the
  near miss is offered.
- `supports-a-media-feature` — `@supports (min-width: 40rem)` is always true and
  `@supports (orientation: landscape)` never; both read like the `@media` that was meant.

Minor, because code that built before can now be refused.
