---
"@ramonda/check": patch
---

A namespace import of `@ramonda/core` is recognised as core.

`import * as core from "@ramonda/core"` followed by `core.requestContext()` was identified as
nobody's — so `late-request-read` and `client-only-request-read` both went quiet on it, although
`core-import.ts` has always said in as many words that a namespace import "arrives here". Each import
shape sits a different distance from its statement, and this one was walked as if it were a named
import: one parent too far, landing on the source file rather than the declaration.

Wrong since the helper was written. Found by planting the shape while reviewing the branch, which is
the only way a silence gets found.
