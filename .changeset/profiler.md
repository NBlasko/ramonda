---
"@ramonda/core": minor
"@ramonda/devtools": minor
---

A profiler: what one commit cost, and which components it rebuilt.

The framework's central claim is about the cost of a commit — a render being a few percent of it,
access tracking turning nine renders into three, structural sharing turning 272 ms into 1.3 ms. Every
one of those numbers was measured in a test, and none of them was ever visible in the panel. An app
author could not check the claim against their own app, which is the only place it matters.

**A commit here is one drain**, not one build: everything a single state change rebuilt, including the
effects and `@updated` bodies it scheduled. Timing builds and summing them would leave out the diff,
the DOM and the post-commit flush — the part that hurts.

**Off until you press record.** A commit is the hottest path in the framework, so sampling it always
would be a tax on every development build. Measured — and measured properly, because the first attempt
ran off-then-on once each and reported recording as *faster*, warm-up drift being larger than the
effect. Alternating runs, medians of seven rounds of 200 commits over a 51-component tree:

```
  off        253.9 ms
  recording  263.0 ms   → 3.6%
```

The `PROFILE` tab lists commits newest first with their duration, and under each one the components
that made it up with their share. The **count** is usually the more useful number: `Row ×40` after
changing one row is not a slow component, it is forty renders that did not need to happen. A list
rather than a flamegraph, deliberately — a flame chart of a flat drain is a picture of one bar.
