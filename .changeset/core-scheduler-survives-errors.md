---
"@ramonda/core": patch
---

An error nobody caught no longer stops the rest of the app from ever rendering again.

`errorHandler` rethrows when there is no `ErrorBoundary` above the component, and that rethrow went
straight out through the scheduler. Whatever was still queued stayed queued — and the scheduler is
built on the invariant that **a non-empty queue means a drain is already pending**, so nothing was
left to drain it. `addTaskToQueue` then dropped every future update in the process: a component
already in the queue returned early on `inBuildQueue`, and one that was not skipped its
`queueMicrotask`, because a queue that is not empty is supposed to already have a drain coming.

Measured on three siblings where one throws in `render()`:

```
before:   bad:0 | good:0 | unrelated:0 | bad:1
after:    bad:0 | good:0 | unrelated:0 | bad:1 | good:42 | good:100 | unrelated:7
```

`good` was set to 42 and then 100; `unrelated` was not even part of the failing drain and only went
dirty afterwards. Neither rendered again. There was no symptom — nothing logged, nothing thrown a
second time, the DOM simply froze while state kept changing underneath it.

The drain now restores that invariant on its way out, whether it leaves normally or through a
throw: anything still pending gets another drain scheduled. Nothing is cleared and nothing is
abandoned, so a pending update is deferred rather than lost. Error handling itself is untouched —
the same single error propagates to the same place it always did.

Also: a throwing effect body no longer leaves the reactivity tracking scope set. `currentEffect` is
a module global, so leaving it set does not fail in the effect that threw — it fails everywhere
else. Every `State.get()` in the app then recorded itself onto a dead effect's dependency set,
holding a strong reference to every signal read from that point on, and nothing reset it until the
next effect flush (which, if that component was the only one with effects, never came). It is now
restored in a `finally`, along with the effect's own dependency bookkeeping.
