---
"@ramonda/css": patch
---

A `ramonda.css.ts` that does not parse is refused, instead of loading as an empty config.

TypeScript's error recovery hid this completely. `transpileModule` reports nothing unless it is
asked to, and it emits whatever it managed to build — measured,
`export default { variables: {{{ };` became `exports.default = { variables: {} };`. So the config
loaded: valid, empty, and nobody's. Nothing threw, nothing was undefined, and every consumer that
does not type-check the config ran with no settings at all.

Measured through a real Vite build: it exited 0 and shipped `.r-pl-2rem` and `.r-c-\#ff0000` — the
unit and the hardcoded colour that very config forbids. Only `ramonda-css check` caught it, because
it alone type-checks the file.

The refusal names the line and column, and says what the silence would have cost.
