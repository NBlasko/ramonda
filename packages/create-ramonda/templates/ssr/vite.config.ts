import { defineConfig } from "vite";

// Used by the DEV server only (server.mjs in middleware mode). The production
// build is esbuild — see the `build:*` scripts, which set the same three options
// on the command line.
//
// JSX compiles through Ramonda's automatic runtime: the compiler imports what it
// needs from `@ramonda/core/jsx-runtime` itself, per file. There is no factory to
// name and nothing to inject.
export default defineConfig({
  define: { __DEV__: "true" },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    // Load-bearing, and the least obvious line in this file. `@state`, `@compute` and the rest are
    // TC39 decorators, which no engine can parse — esbuild has to transform them away, and it only
    // does that below `esnext`. Raise this to `esnext` and the dev server still starts, prints no
    // warning, and hands the browser a module that dies with `SyntaxError: Invalid or unexpected
    // token`. On the production side the same setting is `--target=es2022` in `build:client` and
    // `build:server`, and `ramonda-check-bundle` parses what those emit.
    target: "es2022",
  },
});
