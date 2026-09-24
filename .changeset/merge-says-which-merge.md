---
"@ramonda/css": minor
---

**`merge` is now `mergeClassNames`.** Rename your import; nothing else about it changed.

```diff
-import { merge } from "@ramonda/css";
+import { mergeClassNames } from "@ramonda/css";

-<div className={merge("lead", @@( display: flex; ))} />
+<div className={mergeClassNames("lead", @@( display: flex; ))} />
```

**Because `@ramonda/core` exports a `merge` of its own** — `merge(previous, next, identity?)`, the
deep structural merge that keeps a refetched row's identity — and the collision between them is
silent rather than loud. It does not arrive as a duplicate identifier, because a file imports one or
the other. It arrives as a call that means the wrong thing:

```ts
import { merge } from "@ramonda/core";  // the wrong merge for this
const out = merge("lead", card);        // meant: a class beside a block
```

Measured: `tsc` passes it — `previous` is `unknown` and `next` is `T`, so the call is well typed —
and at run time it returns `card` with `"lead"` gone. A file importing from both packages is one
line away from that.

Leaving `merge` as a deprecated alias was considered and dropped: it would keep exactly the
collision the rename exists to remove. The name says it merges class *names*, which is literally
what it does now that the key lives in the class name.

You are unlikely to be calling it yourself — the emitted module imports it by name, and that import
was already aliased.
