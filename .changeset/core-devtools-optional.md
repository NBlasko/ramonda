---
"@ramonda/core": patch
---

Fix an unhandled rejection in dev mode when `@ramonda/devtools` isn't installed.

In development, core dynamically imports the optional `@ramonda/devtools` for its
side effect (registering the in-page inspector). That import had no `.catch`, so in a
project that never installed devtools — e.g. a scaffold created with the testing add-on
but not the devtools one — running a test surfaced a stray
`Cannot find package '@ramonda/devtools'` unhandled rejection, even though the test
itself passed. The import is now guarded to the browser (`typeof document`) and its
absence is swallowed: no devtools just means no inspector, not an error.
