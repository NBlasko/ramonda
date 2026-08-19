---
"@ramonda/core": patch
---

The ten-second watch armed for a deferred subtree is now cleared when that subtree resumes.

It was harmless in the sense that mattered least: the callback re-checks `hydrationPending` and
`isDestroyed`, so it could never report falsely — which is exactly why nobody noticed. What it did
was hold on. The timer's closure holds the component, and `unref` (the only thing that used to be
done about it) is **Node-only**, so in a browser every deferred subtree kept its component alive for
ten seconds after it was finished with. A page full of them holds a page full of dead components.

Cleared at the top of `resumeHydration`, above its early returns rather than beside the successful
path: the watch is over the moment the promise settles, whichever way it settled, and a subtree that
resumed into a torn-down component has answered the question just as much as one that rendered.

The armed timers live in a `WeakMap` rather than on the component runtime — every component would
carry that field while only a deferred subtree ever arms a timer, and an entry keyed by the
component needs no teardown of its own. +115 bytes raw in the production bundle.

Asserted by counting the timer, because the diagnostic cannot: a resumed subtree produces no report
whether the timer is cleared or not. The test fails without the fix.
