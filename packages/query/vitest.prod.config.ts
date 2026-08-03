import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { resolve } from "node:path";

/**
 * The production test run.
 *
 * This package ships a DEV-only diagnostic (RMQ001, the unstable-query-key report),
 * and "it is stripped from production" was a claim checked by hand — a grep over
 * `dist/index.prod.js`. A grep proves the string is absent from one build; it does
 * not prove the code still *behaves* right with `__DEV__` false, which is the part an
 * app depends on: a key that would be reported must still hash, and hash the same way.
 *
 * `__DEV__` compiles to `process.env.NODE_ENV !== "production"` and vite bakes that in
 * per process, so flipping it inside a test does nothing. Hence a SEPARATE run:
 * `test:prod` sets `NODE_ENV=production`, and this config includes only the
 * `*.prod.test.*` files, which the default run excludes.
 *
 * Mirrors `vitest.config.ts` otherwise — same aliases onto framework source, same
 * environment.
 */
export default defineConfig({
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: 'process.env.NODE_ENV === "test"',
  },
  esbuild: {
    jsxFactory: "__ramondaH",
    jsxFragment: "Fragment",
    target: "es2022",
  },
  resolve: {
    alias: {
      "@ramonda/core/testing": resolve(__dirname, "../core/src/testing.ts"),
      "@ramonda/core": resolve(__dirname, "../core/src/index.ts"),
      "@ramonda/testing-library": resolve(__dirname, "../testing-library/src/index.ts"),
      "@ramonda/devtools": resolve(__dirname, "../devtools/src/index.ts"),
    },
  },
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.prod.test.{ts,tsx}"],
  },
});
