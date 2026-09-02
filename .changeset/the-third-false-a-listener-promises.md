---
"@ramonda/core": patch
---

The third `false` a `Listener` promises now has a test

`listen()` documents three ways it returns `false`: on the server, once the owner is gone, and when
the target resolves to nothing. The first two had tests. The third had none, and it is the one a
caller most easily meets — `on` is a function, and a function reaching for a ref before the node
exists, or for an element a branch has not rendered, answers `null`.

The test pins both halves of that promise: the return value is `false`, and the refusal is SILENT,
because a missing target is a state rather than a fault. It fails if the guard returns `true` instead,
and it fails if the refusal throws.

Found by measuring rather than guessing: `base/Listener.ts` had the weakest branch coverage in the
package at 50%, and this was the only unhit branch of the three that can actually be reached.
