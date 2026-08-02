import { defineConfig } from "vite";

// Ramonda needs two things from the bundler, both handled by esbuild here:
//   1. JSX compiles to factory calls  → `jsxFactory`
//   2. the factory is in scope everywhere → `jsxInject` imports it for you
//
// The factory is named `__ramondaH` rather than `h` on purpose: a bundler injects an
// identifier ONLY if it is not already bound, so a variable named `h` anywhere in a file
// would silently win and every tag in it would call yours instead.
// `@ramonda/core` ships separate dev/prod builds, so Vite already gives you
// development output on `vite dev` and optimized output on `vite build`.
export default defineConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    jsxFactory: "__ramondaH",
    jsxInject: `import { h as __ramondaH } from '@ramonda/core'`,
    target: "es2022",
  },
});
