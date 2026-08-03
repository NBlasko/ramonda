import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";

/**
 * The production test run.
 *
 * This package ships one DEV-only diagnostic — RMF003, the report that `onSubmit` threw — and
 * "it is stripped from production" is a claim worth checking as BEHAVIOUR rather than as a
 * grep over the built file. A grep proves a string is absent from one build; it does not prove
 * a form still submits, validates and recovers with `__DEV__` false, which is the part an app
 * depends on.
 *
 * The sharper reason is that not every guard here is a diagnostic. RMF001 — assigning to a
 * field — throws in production too, on purpose: there is no correct program in which that
 * assignment does something, and silently dropping the write would leave a form whose values
 * do not match what the reader sees. This run is what proves the two are treated differently.
 *
 * `__DEV__` compiles to `process.env.NODE_ENV !== "production"` and vite bakes that in per
 * process, so flipping it inside a test does nothing. Hence a SEPARATE run: `test:prod` sets
 * `NODE_ENV=production`, and this config includes only the `*.prod.test.*` files, which the
 * default run excludes.
 *
 * Mirrors `vitest.config.ts` otherwise — same aliases onto framework source, same environment.
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
