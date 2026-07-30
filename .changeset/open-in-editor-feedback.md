---
"@ramonda/devtools": patch
---

`</>` says what happened, instead of looking dead.

Reported from the SSR playground: clicking it did nothing visible. It was in fact working — no editor
endpoint on that hand-written server, so it fell back to copying the path — but the report went to
the `LOGS` tab, which is not the tab you are on when you click a row in `COMPONENTS`. A control has to
say what it did, where it did it: there is a toast over the panel now.

The tooltip also stopped promising something it cannot deliver. It said `open client.js:8692 in your
editor`, which is the position in the file the engine loaded; it now says `open the definition in your
editor (served at client.js:8692)`. Resolving through the sourcemap needs a fetch, so it happens on
the click, not once per row per render to fill in a tooltip.
