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
  },
});
