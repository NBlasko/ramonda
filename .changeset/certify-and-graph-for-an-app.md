---
"@ramonda/check": patch
---

`--certify` and `--graph-html` speak about an app as an app. Found by the second trial, on a finished app with nothing wrong in it:

- `--certify` no longer asks an app the `current` claim — whether the graph fingerprints the declaration file it ships. An app ships none, and the ✗ read as a failure the app could not fix.
- `--graph-html` counts only the project's own declarations as "nothing points at", and draws what a package brings and the app does not use — `Portal`, `TextArea`, `Interval` — in a band of its own, "from packages, not used by this app". All 13 the trial saw were the framework's. A root called twice in one file is labelled by its call, not `renderStatic$2`.
