---
"@ramonda/core": patch
---

Hydration falling back to a fresh element no longer leaves a live component behind

When the client renders a different host element than the server wrote, nothing can be adopted and
hydration builds fresh, replacing the server's node. `replaceChild` takes only the NODE — the
component sitting on it was left exactly where it was.

The deferred path is where it hurts. A `@deferHydration` subtree ADOPTS the server's node and then
waits, so by the time the promise settles there is an initialized component there, holding restored
state and whatever its client `@create` started. Replacing its node left it running with no DOM: no
`@destroy`, no effect cleanups, no signal detach — its timers went on firing, its subscriptions
stayed attached, and a later write to a signal it had read would render into nodes nobody can see.
Silent, because the page looks right: the fresh element is there and the old one is gone.

Both fallbacks now tear down first — the deferred one in place, through a new `unmountNodeInPlace`
(the node has to still be a child for `replaceChild` to put the fresh one where it was), and the
synchronous one through the ordinary cleanup, since its component was never adopted onto a node but
has already run its client `@create`.
