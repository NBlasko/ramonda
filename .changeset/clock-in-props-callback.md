---
"@ramonda/check": patch
---

`clock-read-while-rendering` reads a hook's props callback too: a `Math.random()` or a clock read there is frozen into the cached props until something unrelated runs the callback again, and then it jumps. The runtime reported the random half as RMD021; the checker read only renders.
