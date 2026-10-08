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
      // Run against framework SOURCE, not dist. A harness that only worked
      // against a built artefact would be testing yesterday's core.
      "@ramonda/core/jsx-dev-runtime": resolve(__dirname, "../core/src/jsx-dev-runtime.ts"),
      "@ramonda/core/jsx-runtime": resolve(__dirname, "../core/src/jsx-runtime.ts"),
      "@ramonda/core/testing": resolve(__dirname, "../core/src/testing.ts"),
      "@ramonda/core": resolve(__dirname, "../core/src/index.ts"),
      "@ramonda/devtools": resolve(__dirname, "../devtools/src/index.ts"),
    },
  },
  test: {
    coverage,
    testTimeout,
    hookTimeout,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
