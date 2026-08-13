---
"@ramonda/check": minor
---

The CLI is reachable on a fresh install.

`pnpm install` creates a package's bin links from what is on disk at that moment, and this package's
bin WAS its build output — so on a clean checkout it warned, skipped the link, and every build that
calls `ramonda-check` failed with `sh: 1: ramonda-check: not found`. It worked on a machine that had
already built the package once, which is why it passed locally and failed in CI on the first run.

The bin is a committed launcher now, which imports `dist/cli.js`. A file that is always present can
always take the link, and the build output is reached through it.
