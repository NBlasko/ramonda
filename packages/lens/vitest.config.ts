import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Tests assert on the DEV behaviour itself — the diagnostics and the reuse
    // guard — so the flag is pinned on rather than read from the environment.
    __DEV__: "true",
    __TEST__: "true",
  },
  test: {
    globals: true,
    environment: "node",
    // The `*.prod.test.*` files belong to `test:prod`, which runs them in a separate process with
    // NODE_ENV=production — `__DEV__` is pinned true above, so they would test the development path
    // here. See vitest.prod.config.ts.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.prod.test.ts"],
  },
});
