---
"@ramonda/lens": minor
---

`@ramonda/lens` 0.1.0 — the first real release.

It has been sitting at 0.0.1 not because it was unfinished but because it never got a changeset. What is
there: `focusOn` and its types, zero dependencies, 718 lines, 57 tests including one that asserts the
public surface, three documentation pages, an entry in the API reference, a demo on the docs site, an
add-on in the scaffolder, and a benchmark against immer. Nothing about it is experimental, so it is
released rather than labelled.

Added before releasing it: **a production test run**. Every warning in `apply.ts` is behind
`if (__DEV__)`, and the ordinary suite pins that flag true — so the code path a published app takes had
never been executed by a test, which is the shape of a bug core shipped once. `test` now runs
`test:prod` after it.

That suite asserts the **contract** rather than the guards, and the reason is recorded in it: I tried to
break it the obvious way, by moving an early `return` inside a `__DEV__` block so production would fall
through where development stops, and production behaved identically — every warned-about path in
`apply.ts` is backed by a second, non-dev guard that catches the same case. So what it asserts is the
promise: a write lands, everything untouched keeps its identity, and a path that goes nowhere returns
**the original root, not a copy**. That last assertion has teeth; "does not throw", which is what it said
first, did not.
