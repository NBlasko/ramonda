---
"@ramonda/css": minor
---

The merge now knows what every shorthand clears, instead of only what the modules on the page told it.
A package built by an older release no longer leaves a longhand standing that CSS would reset: its
`border: var(--x)` written after `border-top-color: red` now wins, as it does in CSS. This adds 3.2 KB
gzipped to the runtime.
