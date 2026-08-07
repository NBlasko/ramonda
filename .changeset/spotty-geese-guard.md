---
"@ramonda/devtools": patch
---

Core's diagnostics reach the Logs tab once, not twice

`@ramonda/core` now emits its diagnostics as records, and in DEV it is what dynamically imports this
package — so this bridge was carrying every core report to the `LOGS` tab a second time, next to the
one core's own log channel had already put there.

The bridge skips `scope === "ramonda/core"` for the tab, and only for the tab: a subscriber added
through `installDiagnostics` still receives everything, which is the entire point of that function.

This is one line, and it needs its own release: without it, a published devtools alongside the new core
shows every core diagnostic as two rows.
