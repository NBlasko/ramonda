---
"@ramonda/core": patch
"@ramonda/query": patch
---

The failure examples stop rendering an empty failure

`query.error` and a `@catchError` argument are `unknown`, and not out of caution. A fetcher is app
code and rejects with whatever it likes — `throw "not found"` after a validation, a status number, a
plain object from a JSON error body. Measured, all three arrive at `query.error` exactly as thrown.

So `(error as Error).message` is `undefined` for three of the four shapes, and a page written that
way renders an **empty** failure in the one place a reader needs words. The framework's own examples
were written that way in nine places, including the `@catchError` example in `@ramonda/core`'s
published types — the first thing a reader of that decorator meets.

They ask `error instanceof Error` first now. `WhatAFetchCanRejectWith.test.tsx` holds the boundary
still: each shape reaches `query.error` unchanged, the cast produces `undefined` for each one that is
not an `Error`, and the `instanceof` read produces something for all four. It fails if a query ever
starts wrapping what it caught.

No new API. `serializeError` already reduces any thrown value to `{ name, message }` and is on the
package's FORBIDDEN export list on purpose, so the fix is at the call sites rather than a new export.
