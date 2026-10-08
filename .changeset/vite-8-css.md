---
"@ramonda/css": minor
---

**Style blocks work on Vite 8.** A file's stylesheet was the module `Card.tsx?ramonda-css.css`, and
Vite 8 stops the build on it: it reads the language from the path without the query, finds `.tsx`,
and fails with *Failed to detect the lang*. It is `Card.tsx.ramonda-css.css` now, and a save sends
it out with the file. The dependency scan is handed to Rolldown in its own shape, so a dev server on
Vite 8 starts without a deprecation warning. And the order warning, which is for development only,
no longer reaches a production bundle on Vite 8: its minifier did not fold the check that guards it.
