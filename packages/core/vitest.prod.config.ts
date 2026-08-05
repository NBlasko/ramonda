import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { coverage } from "../../vitest.coverage.mjs";

/**
 * The production test run. Some safety code only exists in a production build —
 * the update-loop and mount-loop stops that keep a runaway render from freezing
 * the tab. In development those loops are caught earlier by named diagnostics
 * (RMD009), which is stripped from production, so the blunt counters they fall
 * back to are never reached under `__DEV__`.
 *
 * `__DEV__` compiles to `process.env.NODE_ENV !== "production"`, and vite bakes
 * that in per process — flipping it inside a test does nothing. So this is a
 * SEPARATE run: `test:prod` sets `NODE_ENV=production`, which makes `__DEV__`
 * false here, and this config includes only the `*.prod.test.*` files (which the
 * default run excludes for the same reason).
 *
 * The `test`/`define`/`esbuild` blocks mirror `vite.config.ts` on purpose — this
 * run does not build a bundle, so it does not want that file's dts plugin or lib
 * settings, only the test environment.
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    target: "es2022",
  },
  // Core cannot resolve its own published name, so point it at the source.
  resolve: {
    alias: {
      "@ramonda/core/jsx-dev-runtime": resolve(__dirname, "src/jsx-dev-runtime.ts"),
      "@ramonda/core/jsx-runtime": resolve(__dirname, "src/jsx-runtime.ts"),
    },
  },
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: 'process.env.NODE_ENV === "test"',
  },
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.prod.test.{ts,tsx}"],
  },
});
