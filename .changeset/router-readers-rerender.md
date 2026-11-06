---
"@ramonda/router": patch
---

A component re-renders only when the part of the URL it reads moves. A `push` to a new path, and back/forward, re-parsed the whole URL into new objects, so a component reading only `searchParams` or the hash re-rendered on every path change.
