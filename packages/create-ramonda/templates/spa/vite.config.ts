import { defineConfig } from "vite";

// JSX compiles through Ramonda's automatic runtime: the compiler imports what it needs from
// `@ramonda/core/jsx-runtime` itself, per file. There is no factory to name and nothing to inject,
// so nothing here can drift out of step with your tsconfig.
//
// `@ramonda/core` ships separate dev/prod builds, so Vite already gives you development output on
// `vite dev` and optimized output on `vite build`.
export default defineConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    // Load-bearing, and the least obvious line in this file. `@state`, `@compute` and the rest are
    // TC39 decorators, which no engine can parse — esbuild has to transform them away, and it only
    // does that below `esnext`. Raise this to `esnext` and the build still succeeds, still prints
    // no warning, and emits a bundle that dies with `SyntaxError: Invalid or unexpected token` on
    // the first page load. `ramonda-check-bundle`, at the end of `npm run build`, is what catches
    // that before a browser does.
    target: "es2022",
  },
});
