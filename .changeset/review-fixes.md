---
"@ramonda/css": patch
---

Fixes from a review of the shorthand split:

- A CSS-wide keyword in upper case (`margin: 1px INHERIT`) no longer splits an invalid value.
- A quoted font name keeps a `/` or `,` of its own: `font: 12px "A/B", serif`.
- A custom function (`--pad()`) and `attr()` are as unknown as `var()` and keep the shorthand.
- `narrower-after-a-whole-shorthand` no longer refuses an `!important` wider shorthand followed by
  an ordinary narrower one, which renders correctly; nor, across blocks, a family the block sets
  again after the spread.
- `value-differs-across-engines` reports `animation: AUTO` in any case.
- The development warning no longer counts `all` as a whole shorthand.
