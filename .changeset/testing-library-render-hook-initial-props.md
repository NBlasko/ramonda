---
"@ramonda/testing-library": patch
---

**Breaking:** `renderHook`'s `initialOptions` is now `initialProps`, following the
core rename of a hook's input from "options" to "props".

```ts
// before
renderHook(Counter, { initialOptions: { start: 2 } });
// after
renderHook(Counter, { initialProps: { start: 2 } });
```
