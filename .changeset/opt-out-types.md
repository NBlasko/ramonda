---
"@ramonda/testing-library": patch
---

`@ramonda/testing-library/dont-cleanup-after-each` and `/dont-fail-on-diagnostics` carry their types. They were exported with none, so the import a setup file writes failed the type check with TS2882 on TypeScript 6.
