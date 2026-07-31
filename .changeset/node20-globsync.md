---
"@ramonda/core": patch
---

The docs build died on CI's first line, and the cause was the Node version rather than the code.

```
SyntaxError: The requested module 'node:fs' does not provide an export named 'globSync'
```

`fs.globSync` landed in Node 22. CI pins Node 20, the machine that wrote it runs 24, so every local run
was green and the first push was not. The diagnostics-coverage check now walks with `readdirSync`
(`withFileTypes`, Node 10), verified to find **the identical file set** — 81 files in core, 19 in query —
and then run under Node 20.20.2 itself, which is the exact version CI installs.

The whole gate was re-run on that Node with `--force`, because turbo will otherwise replay results cached
from a different runtime and report a pass without running anything: **29/29, 0 cached**.

`pnpm check` now begins with a preflight that reads the pinned version out of the setup action and warns
when the local major differs. It warns rather than fails — a newer Node is not a mistake, and stopping
work over it would be. What it buys is that the next time CI breaks where local passed, the first guess is
already on screen.
