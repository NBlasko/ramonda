---
"@ramonda/core": patch
---

RMD020 says it in words when the value rebuilt on every render is the array of items handed to `list()`: "passes `list()` a new array of items on every render", with the fix — a `@compute` getter — instead of a path ending `.list.each`, which read as the row callback.
