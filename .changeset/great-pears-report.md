---
"@ramonda/core": patch
---

An effect that reads a `@compute` now subscribes to what the compute depends on

A fresh `@compute` touches no signal when it is read — it returns `cache.value` — so it forwards its
own dependencies to whoever is reading. That forwarding fed only the tracker scope
(`trackerContainer`: another `@compute`, a list item, a hook's props cache), not the effect scope.
An effect that read a cached compute therefore recorded no dependencies at all and never re-ran.

The ordering that produces it is the ordinary one, not a corner case: `render()` reads the compute
and fills its cache, effects flush after the commit, so an effect reading the same compute always
reads it on a hit. Every subscription decorator built on the effect machinery — `@onElement`,
`@onWindow`, `@interval`, `@timeout` and anything from `createSubscriptionDecorator` — was affected
whenever its body read a `@compute` instead of a raw `@state`.

Both scopes are now served by one function, `trackDependency`, which `State.get` and the compute's
hit-path forwarding both call — so they cannot be served unevenly again. An effect that writes a
signal still does not subscribe to it, so self-triggering loops stay broken.
