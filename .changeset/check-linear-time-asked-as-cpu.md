---
"@ramonda/check": patch
---

Tests only; nothing a consumer installs changes. The linear-time tests measure the CPU the analyzer
spends instead of the clock, each round on a project of its own, so a loaded machine no longer fails
them and a quadratic pattern planted back still does.
