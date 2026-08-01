import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { resolve } from "node:path";

export default defineConfig({
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: "true",
  },
  // Vite 7 transforms with esbuild, Vite 8 with oxc — and when both are
  // configured it takes oxc and IGNORES the esbuild block. Both are set so the
  // JSX factory survives either, the same way the router package does it.
  esbuild: {
    jsxFactory: "h",
    jsxFragment: "Fragment",
    target: "es2022",
  },
  resolve: {
    alias: {
      // Run against framework SOURCE, not dist. A harness that only worked
      // against a built artefact would be testing yesterday's core.
      "@ramonda/core/testing": resolve(__dirname, "../core/src/testing.ts"),
      "@ramonda/core": resolve(__dirname, "../core/src/index.ts"),
      "@ramonda/devtools": resolve(__dirname, "../devtools/src/index.ts"),
    },
  },
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
