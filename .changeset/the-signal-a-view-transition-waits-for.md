---
"@ramonda/core": patch
---

`/concepts/lifecycle` documents what `@updated` is for beyond measuring: it is the signal a browser view
transition waits for.

A CSS transition needs the element to exist while it plays, and removing a row takes the node out — so the
exit never runs. `document.startViewTransition` snapshots the old frame instead, and waits for your
callback's promise to resolve once the DOM matches the new state. That is `@updated`, exactly, so the
pattern needs nothing new: six lines of app code.

**And it says what not to do.** Updates are batched on a microtask, so awaiting a few turns inside the
callback happens to be enough — measured, and "happens to be" is the whole problem with it. Both edges are
written down too: a change that schedules no render never fires `@updated`, so the callback needs a
deadline as a net; and in a cascade the first `@updated` resolves before the last pass.

The playground has it as a hook rather than a decorator — `apps/playground-core/src/demos/ViewTransition.tsx`
— because the framework already has the signal, and the half that needs thought is `view-transition-name`
in a stylesheet, which no decorator can reach.
