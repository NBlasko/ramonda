---
"@ramonda/lens": minor
---

Diagnostics are records with codes — `RML001` … `RML011`

Every report this package makes now carries a **stable code** and reaches a collector as a structured
record, not only the console as a sentence:

```
[Ramonda lens RML001] .profile is undefined, so .profile.city could not be reached. Nothing was changed.

→ Only the LAST hop creates what it names, so a gap before it cannot be walked through. Set the
  intermediate value first, or `merge` the whole object into place.
```

**Why a record.** A string carries a fault to a human and nowhere else: nothing can filter it by
severity, group it by cause, or count it, without parsing prose. So a report is now a
`RamondaDiagnostic` — `code`, `scope`, `severity`, `message`, `fix`, `data`, `time` — handed to
whatever sink is installed:

```ts
globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => {
  if (record.severity === "error") myCollector.alert(record);
};
```

`globalThis` rather than an event on `window`, so the same line works in the browser, in Node, in a
worker and during a server render. A collector is optional: with none installed the call is one
property read and the message still goes to the console, and installing one adds a consumer rather
than silencing anything. This package still has **no dependencies** — the contract is the shape and
the name of the sink, which is why it is documented rather than imported.

**Eleven codes, not twenty-one messages.** A code is a fault *class* — a cause with one fix — so `at`
on an object and `where(…).remove()` on an object are one code with two messages. Each has a section
in the [diagnostics reference](https://ramonda.pages.dev/reference/diagnostics), and
[Messages you might see](https://ramonda.pages.dev/lens/messages) maps every message text to its code
for when you have the console output and not the code.

**Severity says whether the code can be right**, which is a sharper line than "how bad it looks".
An **error** means it cannot be, whatever the data holds — a wrong kind of value (`RML003`, `RML006`),
a refused key (`RML009`), a branch that returns nothing (`RML008`), a second write (`RML010`). A
**warning** means it may well be, and the data was simply empty or absent (`RML001`, `RML004`,
`RML005`, `RML007`). A path steps *through* a nullable value by design, so reporting that as an error
would raise an alarm about a program doing exactly what it was written to do. Errors print with
`console.error`, warnings with `console.warn`.

The two faults that **throw** now report before they throw, so a panel sees what a throw would
otherwise keep to itself.

Production is unchanged and emits **nothing**: every report is behind `__DEV__` at its call site, and
the production suite now asserts that through the sink — a devtools bundle that happens to be loaded
receives silence rather than a stream to filter. `RML009`'s *check* still runs in production, because
a guard that ran only in development would protect the one build never exposed to a request; only its
message is stripped.

**It costs 32 bytes gzipped in production** — 1332 to 1364, `gzip -9` of the minified bundle — and
getting it there took a measurement rather than an assumption. Every report is behind `__DEV__`, so
the bundler drops `report`, and it *keeps the 2.2 KB table of fix text that only `report` read*:
tree-shaking is one reachability pass over top-level symbols, and dropping a function does not send it
back to reconsider what that function was the only reader of. A table behind `__DEV__ ? … : {}` needs
no such pass — the literal is gone at parse time. The same trick applied to the function bodies leaves
three empty shells worth 16 bytes instead of 300. Both numbers are recorded where the code is, because
neither is guessable from reading it.

Two tripwires keep the contract from rotting, since a written contract is the one thing in this
repository with nothing behind it: the record's shape is asserted in this package's suite, and the
docs' `check-api-coverage.mjs` now fails the build when a code has no section in the reference, when a
package raises a code carrying another package's prefix, or when a section describes a code that is
raised nowhere. Each of the four checks is proved to fail on demand with `DOCS_SELFTEST`.
