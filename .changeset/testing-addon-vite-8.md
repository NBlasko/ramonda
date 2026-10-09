---
"create-ramonda": patch
---

**The `testing` add-on's tests run on Vite 8.** Its `vitest.config.ts` carried an `esbuild` block,
which Vite 8 only translates into Oxc's settings — and Oxc cannot lower a decorator, so a new
project's first `vitest run` died with `SyntaxError: Invalid or unexpected token`. It takes the app's
own plugin now, `ramonda()`, and `ramondaCss()` beside it when the project has style blocks. With the
Biome add-on and style blocks, `npm run lint` and `npm run format` hand `src` to `ramonda-css`, since
biome cannot read a block.
