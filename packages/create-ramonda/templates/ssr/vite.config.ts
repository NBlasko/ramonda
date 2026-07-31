import { defineConfig } from "vite";

// Used by the DEV server only (server.mjs in middleware mode). The production
// build is esbuild — see the `build:*` scripts.
//
// Ramonda needs two things from the transform, and the SECOND is the one that
// makes server-side hot reload work at all:
//   1. JSX compiles to `h(...)` — `jsxFactory` + `jsxInject` puts `h` in scope.
//   2. `target: "es2022"` down-levels TC39 decorators. Vite's default SSR target
//      is `esnext`, which LEAVES `@Host(...)` in the output — and Node cannot parse
//      a decorator, so `ssrLoadModule` dies with "Invalid or unexpected token".
//      Setting es2022 is what lets the dev server evaluate your components at all.
export default defineConfig({
  define: { __DEV__: "true" },
  esbuild: {
    jsxFactory: "h",
    jsxInject: `import { h } from '@ramonda/core'`,
    target: "es2022",
  },
});
