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
    target: "es2022",
  },
});
