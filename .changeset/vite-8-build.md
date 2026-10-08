---
"@ramonda/build": minor
---

**`ramonda()` works on Vite 8.** Vite 8 transforms with Oxc, and Oxc cannot lower a TC39 decorator
for any target — measured on 8.3.4, a build with the plugin was green and emitted `@Host("div")
class …`, which no engine parses. On Vite 8 the plugin now gives Oxc the JSX settings and lowers the
decorators itself, running esbuild over each of the app's modules after Oxc. On Vite 7 nothing
changes. `oxc: false`, and an `oxc.jsx` that is not Ramonda's, are refused the way their esbuild
spellings are. `esbuild` is a dependency now, because Vite 8 no longer brings it.
