---
"@ramonda/form": patch
"@ramonda/query": patch
---

Devtools registration no longer costs a production build

Registering a panel used to leave a method and a field on the class, and neither can be tree-shaken:
esbuild cannot prove a method is never reached dynamically, and a declared field is emitted on every
instance. So every form in a production app carried ~500 bytes of dead code and a per-instance slot,
and its `@destroy` called a cleanup that could not exist.

The description and the cleanup now live in the module that owns the panel — a free function and a
`WeakMap` keyed by instance — leaving one `if (__DEV__)` line at each end of the class. `@ramonda/form`'s
production bundle is 529 bytes smaller, and every devtools name is now absent from it.

No behaviour changes; the panel works exactly as before.
