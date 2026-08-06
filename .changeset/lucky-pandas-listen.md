---
"@ramonda/query": minor
---

`RMQ001` and `RMQ002` are records, not just console lines

Both diagnostics now reach [the collector every reporting package shares](https://ramonda.pages.dev/reference/diagnostics#capturing-them),
so `@ramonda/devtools` shows them in its `LOGS` tab and `installDiagnostics` can take them anywhere
else. A string carries a fault to a human and nowhere else: nothing could filter these by severity or
group them by cause without parsing prose.

What a reader sees changes in two small ways. The console line names the package —
`[Ramonda query RMQ001] …` — and the advice is separated from what happened, printed under `→` and
carried in the record's own `fix` field, so a panel can render it apart from the message.

**Deduplication is unchanged and now published.** A key is hashed on every render, so an unstable one
would report on every pass; one report per distinct cause is what that has always meant. The record
carries the `dedupKey` this package deduplicates on — `RMQ001:function`, `RMQ002:<key>:<reason>` — so a
collector collapses exactly what this package collapses rather than guessing.

Nothing ships: the table of advice sits behind `__DEV__ ? … : {}` rather than being merely unreachable,
because a bundler drops the function and keeps a table only that function read — measured at 2.2 KB in
`@ramonda/lens`, which is where that lesson was paid for. The production suite still asserts that an
unstable key is hashed silently.
