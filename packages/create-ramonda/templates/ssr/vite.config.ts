import { defineConfig } from "vite";

// Used by the DEV server only (server.mjs in middleware mode). The production
// build is esbuild — see the `build:*` scripts.
//
// Ramonda needs two things from the transform, and the SECOND is the one that
// makes server-side hot reload work at all:
// JSX compiles through Ramonda's automatic runtime: the compiler imports what it needs from
// `@ramonda/core/jsx-runtime` itself, per file. There is no factory to name and nothing to
// inject.
export default defineConfig({
  define: { __DEV__: "true" },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    target: "es2022",
  },
});
