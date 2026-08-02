import { defineConfig } from "vite";

// Used by the DEV server only (server.mjs in middleware mode). The production
// build is esbuild — see the `build:*` scripts.
//
// Ramonda needs two things from the transform, and the SECOND is the one that
// makes server-side hot reload work at all:
//   1. JSX compiles to factory calls — `jsxFactory` + `jsxInject` put it in scope. The
//      name is `__ramondaH`, not `h`: a bundler injects only an UNBOUND identifier, so a
//      variable named `h` in a file would silently win and break every tag in it.
//   2. `target: "es2022"` down-levels TC39 decorators. Vite's default SSR target
//      is `esnext`, which LEAVES `@Host(...)` in the output — and Node cannot parse
//      a decorator, so `ssrLoadModule` dies with "Invalid or unexpected token".
//      Setting es2022 is what lets the dev server evaluate your components at all.
export default defineConfig({
  define: { __DEV__: "true" },
  esbuild: {
    jsxFactory: "__ramondaH",
    jsxInject: `import { h as __ramondaH } from '@ramonda/core'`,
    target: "es2022",
  },
});
