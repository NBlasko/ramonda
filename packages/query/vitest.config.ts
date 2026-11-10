import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";
import { resolve } from "node:path";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: "true",
  },
  // The plugin an app uses. It sets the JSX runtime, and lowers the decorators on Vite 8, where
  // Oxc cannot and an `esbuild` block here is only translated into Oxc's settings.
  plugins: [ramonda()],
  resolve: {
    alias: {
      // Run tests against framework source (live), like the router does. The
      // `/testing` alias must come FIRST — a string alias matches by prefix, so
      // the bare "@ramonda/core" entry would otherwise swallow it.
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
    testTimeout,
    hookTimeout,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // The `*.prod.test.*` files belong to `test:prod`, which runs them in a separate
    // process with NODE_ENV=production — `__DEV__` is baked in per process, so they
    // would test the development path here. See vitest.prod.config.ts.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.prod.test.{ts,tsx}"],
  },
});
