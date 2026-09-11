import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

/**
 * The docs app's tests guard the two things this app IS: the examples, and the build.
 *
 * Every demo on the site is code people copy, so a demo that trips a diagnostic
 * teaches the mistake the diagnostic exists to prevent. `src/__tests__/demos.test.tsx`
 * mounts all of them with the strict render on and fails if any reports.
 *
 * `src/__tests__/ProdAppBuild.test.ts` is the other one, and it is here rather than in
 * core because this is where a real application build lives: it builds a fixture app with
 * this app's own aliases and asserts that no diagnostic and no devtools reached the
 * output. It runs in node and shells out to esbuild, so it needs `.ts` in `include`.
 *
 * The aliases matter more here than anywhere else: the demos import `@ramonda/core` by
 * specifier, and resolving that to the built package while the harness uses source
 * would put TWO copies of the framework in the graph — components extending a
 * different `Component` than the one bootstrapping them. Measured, when this was first
 * written from the wrong package: every demo threw
 * `Cannot set properties of undefined (setting 'isInitialized')`.
 */
export default defineConfig({
  define: { __DEV__: "true", __TEST__: "true" },
  esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core", target: "es2022" },
  resolve: {
    alias: {
      "@ramonda/core/jsx-dev-runtime": resolve(__dirname, "../../packages/core/src/jsx-dev-runtime.ts"),
      "@ramonda/core/jsx-runtime": resolve(__dirname, "../../packages/core/src/jsx-runtime.ts"),
      "@ramonda/core/testing": resolve(__dirname, "../../packages/core/src/testing.ts"),
      "@ramonda/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@ramonda/query": resolve(__dirname, "../../packages/query/src/index.ts"),
      "@ramonda/router": resolve(__dirname, "../../packages/router/src/index.ts"),
      "@ramonda/lens": resolve(__dirname, "../../packages/lens/src/index.ts"),
      "@ramonda/devtools": resolve(__dirname, "./devtools-stub.ts"),
    },
  },
  // `ProdAppBuild.test.ts` shells out to esbuild, which is the slowest thing any test here does.
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/__tests__/*.test.{ts,tsx}"],
    // `scripts/highlighter.mjs` is a build script, not app source: it reads the grammar files beside
    // it through `import.meta.url`, which vite rewrites to a served `/@fs/…` URL. Loaded by node, as
    // the content build loads it, the URL is a real path and the module is the one that ships.
    server: { deps: { external: [/scripts\/highlighter\.mjs$/] } },
    testTimeout,
    hookTimeout,
  },
});
