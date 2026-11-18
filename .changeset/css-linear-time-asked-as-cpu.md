---
"@ramonda/css": patch
---

Tests only; nothing a consumer installs changes. The linear-time tests measure the CPU a reading takes instead of
the clock, each round on an input of its own, so a loaded machine no longer fails them and a quadratic pattern still
does; the ones whose linear and quadratic costs came too close read inputs four times larger. Two tests count instead
of timing: the reading budget by readings begun, and the remembered value by readings it did not begin.
