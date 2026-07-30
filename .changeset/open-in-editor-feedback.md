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

And the endpoint in this repo's SSR playground no longer answers `200` for work it did not do.
`launch-editor` returns **silently** when the file does not exist — no callback, no log — which is how
a request for `assets/client.js:8692` (a position in the bundle, before the sourcemap landed) produced
a cheerful `ok` and nothing else. It checks the file itself now, answers `422` with the path, and
passes the error callback so a spawn that fails is a 500 rather than a line on a console nobody is
reading. `404` is left to mean the one thing the panel needs it to mean: this server has no such
endpoint, use the clipboard.
