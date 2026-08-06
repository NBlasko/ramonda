---
"@ramonda/core": patch
---

Five diagnostics were documented as warnings while they report as errors

`DIAGNOSTICS.md`'s table said "warning" for RMD003, RMD010, RMD016, RMD021 and RMD023, all of which
the registry reports as `error` — each with a comment in `diagnostics.ts` saying why it is one. The
distinction is the part a reader acts on: an error means the result is wrong, a warning means the app
only did more work to get there. The devtools panel raises its alert on `error` alone, so the table
disagreed with what a developer actually saw.

The table now follows the registry, and `DiagnosticsRegistry.test.ts` pins them to each other: the
`DiagnosticCode` union, the `SPECS` keys and the table must name the same codes with the same
severities, a retired number must be gone from both and still documented as retired, and no section
may describe a code nothing can raise. The docs site had this tripwire for its own reference page;
the package's table had none.

Two runtime messages also stopped naming `@effect`, a decorator that no longer exists — the runaway
and update-loop errors now point at `@mount`, `@updated` and subscriptions, which is what a reader
can go and look for.
