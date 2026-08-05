import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";

export default defineConfig({
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: "true",
  },
  // Both transformers are configured for the same reason the query package does it:
  // Vite 7 uses esbuild and Vite 8 uses oxc, and with both present oxc wins and the
  // esbuild block is ignored entirely. This package has no vite of its own.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    target: "es2022",
  },
  resolve: {
    alias: {
      // The `/testing` alias must come FIRST — a string alias matches by prefix.
      "@ramonda/core/jsx-dev-runtime": resolve(__dirname, "../core/src/jsx-dev-runtime.ts"),
      "@ramonda/core/jsx-runtime": resolve(__dirname, "../core/src/jsx-runtime.ts"),
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
    // The `*.prod.test.*` files belong to `test:prod`, which runs them in a separate process
    // with NODE_ENV=production — `__DEV__` is baked in per process, so they would test the
    // development path here. See vitest.prod.config.ts.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.prod.test.{ts,tsx}"],
  },
});
