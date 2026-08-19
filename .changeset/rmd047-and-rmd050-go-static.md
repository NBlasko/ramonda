---
"@ramonda/check": minor
---

Two more runtime diagnostics move to before the code runs: **`decorator-that-adds-nothing`**
(`RMD050`) and **`unkeyable-memoized-argument`** (`RMD047`).

**`decorator-that-adds-nothing`** — `@state` already puts a field in the hydration blob, so a
`@persist` beside it adds nothing at all. It is a small fault worth reporting for a specific reason:
the line that does nothing looks exactly like the line that does the work, so it survives every
reading of the file and gets copied into the next component. The capability table it judges by is
the one `debug/claimMember.ts` keeps, so the pairs it reports are the pairs the runtime reports —
and two decorators doing DIFFERENT work on one member (`@created` with `@mounted`, `@watchProp` with
`@updated`) stay silent in both.

The same decorator written twice is left to `duplicate-decorators`, which already had it. Found by
building this rule and watching both fire on one line: two reports on one line is how a reader
learns to skim past both.

**`unkeyable-memoized-argument`** — `@memoizedHandler` caches by its arguments, and a key holds a
string, a number or a boolean. An object cannot be compared by value, and keying on its identity
would miss every time, so the handler is rebuilt on every render — the churn the decorator exists to
prevent. Development throws; **production builds the handler and moves on without caching**, which
is why saying it early is worth something: the page works and only the memoisation is lost, silently.

It found a real one on its first run. In the playground's form page the decorator sat on `tagRow`,
which takes an object and returns markup, while the comment above it described `removeTag` — a doc
comment written between the two had left the decorator on the member above. That call could never
be memoised, and in development it throws the moment the list has a row in it. Now fixed.

Both report only what can be proved. `this.pick(row.id)` is right and `this.pick(row)` is the fault,
and they look the same from here without asking for a type — so an argument this cannot read is left
alone, and a parameter annotated as an object, array or function is reported once at the declaration
instead, where every call is one fault.
