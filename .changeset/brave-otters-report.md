---
"@ramonda/core": minor
---

Every `RMD` diagnostic is also a record

`diagnose` now hands each report to [the collector every reporting package shares](https://ramonda.pages.dev/reference/diagnostics#capturing-them),
so a devtools panel, a test or a log shipper can group and filter them by `code` and `severity`
instead of parsing a message. The console line and the `ramonda:dev-log` event are unchanged: this
adds a consumer rather than replacing one.

Three details are decided rather than incidental.

**`warning` becomes `warn` in the record.** This package has always said `warning`, and the protocol's
word is `warn`; the vocabulary belongs to the protocol, so the translation happens at the emit point.
A collector filtering on severity depends on it being exact.

**The record carries the dedup key.** `diagnose` reports once per `code:dedupKey`, and that key is now
published, so a collector collapses exactly what core collapses rather than guessing.

**`data` carries values, and anything live is dropped.** That argument is `unknown` and always has
been, because it goes to a console — where an object is the useful thing, expandable and inspectable.
A record is different: a collector keeps a bounded history, so anything live in one stays alive as long
as the history does. `propsStability` passes `{ cached, fresh }`, which are the actual prop values — a
component, a DOM node, an array of them are all ordinary things to find there. So the console keeps
the whole object and the record keeps the primitives, filtered centrally rather than trusted to
thirty-nine call sites.

**A duplicate the tests caught before it shipped.** In DEV core dynamically imports
`@ramonda/devtools`, whose bridge also puts records in the `LOGS` tab — so every core diagnostic
rendered twice the moment core started emitting them. Seventeen of core's own cases failed on it: a
test reading the dev-log channel found the bridge's payload instead of core's message. The bridge now
skips core's scope for the tab and only for the tab, because core already reaches it; a subscriber
still receives everything.

Still on the older channel: the handful of core messages that carry no code — `hydration/*`,
`vdom/h`, `watchProps`, `decorators`, `CreateRamonda` — which reach the console and the panel but not
the sink, because a record needs a stable code and these have none yet. They are the last ones left.

Two things a record will not carry, both about `data` holding what an application put in a prop.
A **getter is never invoked**: `Object.entries` would, and a getter is arbitrary code — it can throw,
out of the diagnostic that was explaining what was wrong with the app, or write state, which lands
mid-render and raises `RMD001` against whoever was rendering. It is skipped by descriptor, so it is
never read. And a **`bigint` arrives as its digits**: it is the one primitive `JSON.stringify` throws
on, which is what every collector shipping a record performs, and a `bigint` prop needs no cooperation
from anybody.
