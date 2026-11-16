---
"@ramonda/core": minor
"@ramonda/check": minor
"create-ramonda": minor
---

**Breaking:** `@ShouldUpdateOnPropsChange` is removed, and `RMD040` is retired with it. It took a
predicate an app writes, and a predicate can stop a component rendering when it should — silently, and
nothing can check it. Nothing in this repository or either trial app used it. A prop that arrives
rebuilt with the same contents is declared a value with `@StableProps`, which takes names and does the
comparing itself. `duplicate-decorators` no longer names it.
