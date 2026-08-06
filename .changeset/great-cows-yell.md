---
"@ramonda/core": patch
---

A failed lazy import is quiet in production

`AsyncLoad` wrote the error to the console on every failure, in every build. The app had already been
told, in the framework's own way — `errorFallback` is handed `{ error, retry, attempt }`, so it can
render what it likes, report where it likes and offer the retry — so the console line was a second
channel it could not turn off.

A chunk that fails to load is not always an incident. A deploy rotating its assets, a reader going
offline, one dropped request: apps handle those, and a red line for each is noise they did not ask
for. Development keeps it, because there the reason is what you need and there is nowhere else it
would go — the same split `h.ts` makes for a function in tag position.
