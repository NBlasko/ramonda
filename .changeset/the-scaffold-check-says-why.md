---
"@ramonda/core": patch
---

The scaffold check prints why a command failed. It was swallowing the reason.

`String(error.stdout ?? error.stderr ?? error)` looks like a fallback chain and is not one: `??` falls
through only on `null` and `undefined`, and a command that writes its error to stderr leaves `stdout` as
`""`. So the detail was the empty string, `if (detail)` was false, and the check printed a headline with
nothing under it — which is exactly what a CI run did:

```
[scaffold] `npm ci --omit=dev` failed — a production install of the generated project
Error: Process completed with exit code 1.
```

Both streams are read now, and the tail is 60 lines rather than 25 — an `npm ci` failure puts its useful
line above a wall of flag documentation. Planted to prove it: with the lockfile removed, npm's own output
now reaches the log, and before this it did not.

This is the whole change. It does not fix that CI run — that run's reason is gone, because it was never
printed — it makes the next one say so.
