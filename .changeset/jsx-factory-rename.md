---
"@ramonda/core": minor
"create-ramonda": minor
---

New projects get `jsxFactory: "__ramondaH"` instead of `h`, because a one-letter factory is a name
someone will reuse — and reusing it broke the file, sometimes silently.

The factory is only in scope because the bundler injects it, and **a bundler injects an identifier
only if it is not already bound**. So a binding named `h` wins. Measured with esbuild:

```tsx
const h = 5;                          // in a function → TypeError: h is not a function
function h(x) { return x; }           // at module top → NO error at all
export function Card() {
  return <div>ok</div>;               // becomes YOUR h("div", …) — the page is silently wrong
}
```

The module-level case is the bad one: no error, no warning, wrong output.

`__ramondaH` is a name nobody writes, so the collision cannot happen. **It costs nothing** — the
bundle is byte-identical (12223 B gzipped either way on a hello-world), because a named import
tree-shakes exactly as before and the minifier shortens the binding again. A namespace factory
(`R.h`) also fixes it and was rejected: it defeats tree-shaking, +36% gzipped.

**Nothing to migrate.** `h` is still exported and still declared as an ambient global, so a project
configured with `jsxFactory: "h"` keeps type-checking and building exactly as it did. Only new
scaffolds and the docs' setup instructions changed.
