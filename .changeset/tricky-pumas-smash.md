---
"@ramonda/check": minor
---

Reports a single-use decorator declared twice on one class

`@catchError`, `@Host`, `@ShouldUpdateOnPropsChange` and `@StableProps` each answer a question that
has one answer. Declared twice, the last one wins and the others never run — silently, and the one
being read may be the dead one.

The framework reports what it can at runtime (RMD032 for `@catchError`), but only once the component
mounts, which is the gap this package exists for: a class behind a condition nobody clicked ships
with the fault and nothing has said a word.

A SUBCLASS declaring its own is not this. That is an override — the way a role is specialised — so
only declarations on one class body are counted.
