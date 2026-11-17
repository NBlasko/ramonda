---
"@ramonda/css": patch
---

Tests only; nothing a consumer installs changes. The linear-time tests measure the CPU a reading takes instead of
the clock, over inputs four times larger, so a loaded machine no longer fails them and a quadratic pattern still
does.
