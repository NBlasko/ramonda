import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { resolve } from "node:path";

export default defineConfig({
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: "true",
  },
  // Vite 7 transforms with esbuild, Vite 8 with oxc — and when both are
  // configured it takes oxc and IGNORES the esbuild block entirely. This package
  // has no vite of its own, so it follows whatever the workspace hoists, and the
  // day that became 8 every test stopped parsing: the JSX factory was silently
  // dropped. Both are set so it works either way.
  esbuild: {
    jsxFactory: "h",
    jsxFragment: "Fragment",
    target: "es2022",
  },
  resolve: {
    alias: {
      // Run tests against framework source (live), like the playground. The
      // `/testing` alias must come FIRST — a string alias matches by prefix, so
      // the bare "@ramonda/core" entry would otherwise swallow it.
      "@ramonda/core/testing": resolve(__dirname, "../core/src/testing.ts"),
      "@ramonda/core": resolve(__dirname, "../core/src/index.ts"),
      "@ramonda/testing-library": resolve(__dirname, "../testing-library/src/index.ts"),
      // core dynamically imports devtools in dev; alias it so it resolves.
      "@ramonda/devtools": resolve(__dirname, "../devtools/src/index.ts"),
    },
  },
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
