---
"@ramonda/check": minor
"create-ramonda": minor
---

`ramonda-check-bundle` now ships, and a scaffolded project runs it.

Ramonda's decorators are TC39 syntax that no engine can parse, so the bundler has to transform them
away. Which it does is decided by one line — `target` — and `esnext`, the value that reads like a
modernisation, is the one that leaves them in. The build still succeeds, prints no warning, and
emits a file that dies with `SyntaxError: Invalid or unexpected token` on the first page load.

This repository has been guarded against that for a while; a project scaffolded with
`npm create ramonda` was not. Both now end their `build` with `ramonda-check-bundle`, which parses
every emitted file and fails the build instead of the browser.

- `@ramonda/check` gains a second binary, `ramonda-check-bundle <dir-or-file>...`. Nothing about
  `ramonda-check` changes.
- Both templates end `build` with it, and both `vite.config.ts` files now say what `target: "es2022"`
  is for — the setting was already correct and completely unlabelled, which is how it got removed
  the first time.
