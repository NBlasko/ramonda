import { defineConfig } from "vite";

// Ramonda needs two things from the bundler, both handled by esbuild here:
//   1. JSX compiles to `h(...)` calls  → `jsxFactory: "h"`
//   2. `h` is in scope in every .tsx   → `jsxInject` imports it for you
// `@ramonda/core` ships separate dev/prod builds, so Vite already gives you
// development output on `vite dev` and optimized output on `vite build`.
export default defineConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    jsxFactory: "h",
    jsxInject: `import { h } from '@ramonda/core'`,
    target: "es2022",
  },
});
