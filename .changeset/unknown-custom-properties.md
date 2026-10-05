---
"@ramonda/css": minor
---

**`unknownCustomProperties: false` refuses a custom property made up on the spot.** With it, a block
or a `style` attribute may only set or read a token, a `@@property( … )` through its binding, or a
name listed in `externalCustomProperties`; `--brand: red;` and `var(--brand)` anywhere else are
refused (`unknown-custom-property`) in the build, the editor and `ramonda-check`. Left out, nothing
changes.
