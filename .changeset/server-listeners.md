---
"@ramonda/core": patch
---

A server render no longer attaches event listeners

A listener is not an attribute, so `innerHTML` cannot serialize one — attaching them on the server was
harmless, and that is why it stood: skipping looked like it would cost the client a check to save work
nobody sees.

Measured, and it is worth it. 100 rows with four handlers each — 400 listeners — rendered in 2.104 ms
with them attached and 1.222 ms without: **42% of a listener-heavy server render**, and it also drops
the `_listeners` bookkeeping those elements were carrying for nothing.

The client pays one boolean, already in hand, tested inside a branch that was about to make two DOM
calls anyway.

**Which side it is comes from the owning component's runtime, not from `getRenderEnv()`.** That
module-level flag has a documented contract — only `createComponent` may read it, and only for a root
mount — because it is restored before the first `await`, so an element built during the drain that
follows would read "client" whatever side it is really on. There is a test for exactly that: a
`@mount` that fills a list after an await, whose rows appear in the markup and attach nothing. It
fails if the flag is used instead.
