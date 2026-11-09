---
"@ramonda/testing-library": minor
---

`render` refuses when the test runner has no global `afterEach` — a vitest without `globals: true` — instead of skipping the cleanup and the diagnostics check after each test in silence. The error says what is missing and both ways out: turn on the runner's globals, or import `dont-cleanup-after-each` and `dont-fail-on-diagnostics` to say the project does them itself.
