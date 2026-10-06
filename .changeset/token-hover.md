---
"@ramonda/css": patch
---

**A hover on a token says what it is.** `$color.accent.quiet`, in a block or in code, now shows its
kind, the custom property it is written as (`var(--color-accent-quiet)` — the name a browser's style
panel shows), what it starts as, and whether it may change. Codegen writes it as a doc comment above
each token, so run `ramonda-css codegen` once after updating.
