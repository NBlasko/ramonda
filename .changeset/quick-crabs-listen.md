---
"@ramonda/devtools": patch
---

The `LOGS` tab renders a row whose `data` cannot be JSON

A diagnostic's `data` reaches that tab exactly as the framework passed it, and for `propsStability`
that is the real prop values — so anything an application can put in a prop arrives there. Three of
those defeat `JSON.stringify`, and each one **throws** rather than degrading: a `bigint` ("Do not know
how to serialize a BigInt"), a cycle, and a getter that throws when read. Out of the log listener that
is an uncaught exception, so the row never rendered — the panel failing on the report it exists to
show.

Measured with a `bigint`, which needs no cooperation from anybody: a `bigint` prop is an ordinary
thing to write. A `bigint` now reads as `10n` and a cycle as `[circular]`, so the value and the shape
both survive; a value that cannot be read at all falls back to the row without its data rather than
taking the row with it.
