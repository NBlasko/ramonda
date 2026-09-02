---
"@ramonda/core": patch
---

Importing `@ramonda/core` in a process with no DOM no longer throws

`debug/logger.ts` called `window.addEventListener` at MODULE LOAD, inside `if (__DEV__)`, with no
check for a DOM. The development build is the `default` export condition and replaces `__DEV__` with
`true`, so this:

    import "@ramonda/core";

threw `ReferenceError: window is not defined` in a bare Node process, before the caller's first line
ran. Measured against `dist/index.js` rather than argued from the source.

Nothing in the repository could see it. Our own SSR installs its DOM shim first, the suites run
under jsdom, and the `sideEffects` gate asks a BUNDLER what survives importing each entry — a
bundler never evaluates the module. What a user does that we did not: a script, a CLI, a codegen
step, a test runner in the node environment, or an app that imports the framework before installing
its shim.

The same check now guards `ramondaLog`'s event dispatch, which is reachable with no DOM for the same
reason: a decorator reports at class DEFINITION time, so a Node process that merely imports a
component module raises diagnostics without rendering anything. The console line and the log vault
are unaffected, so a panel that connects later still gets everything.

Found from the other side, which is worth recording: `debug/timerGuard.ts` guards the same thing at
the same moment and always did. Its guard is unhit in every suite and reads exactly like the dead
ones deleted from `Listener` and `@onWindow` — it is the one place that had it right.

`scripts/check-bare-import.mjs` now imports every published package's development AND production
entry in its own Node process, and fails if either throws. `@ramonda/devtools` is listed as
browser-only with its reason, and is required to keep failing, so the exception cannot rot into
silence.
