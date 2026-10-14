---
"@ramonda/core": patch
---

An app without `@ramonda/devtools` no longer logs `Failed to resolve import "@ramonda/devtools"` from the Vite 8 dev server on every start. The optional panel import is written so the dependency pre-bundler cannot fold it into a literal it then tries to resolve.
