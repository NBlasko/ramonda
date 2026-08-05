import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    port: 3000,
  },
  // The framework guards dev-only code with `if (__DEV__)`. Define it so the
  // playground runs (and so the devtools + dev logs are active).
  define: {
    __DEV__: JSON.stringify(true),
  },
  esbuild: {
    jsxFactory: "__ramondaH",
    jsxInject: `import { h as __ramondaH } from '@ramonda/core'`,
    target: "es2022",
  },
  resolve: {
    alias: {
      // Use framework source directly (live reload, no build step). Devtools is
      // dynamically imported by core in dev, so alias it to source too.
      // The subpaths come FIRST: a string alias also matches `<key>/…`, so `@ramonda/query` would
      // otherwise capture `@ramonda/query/devtools` and rewrite it to `…/index.ts/devtools`.
      "@ramonda/query/devtools": resolve(__dirname, "../../packages/query/src/devtools.ts"),
      "@ramonda/form/devtools": resolve(__dirname, "../../packages/form/src/devtools.ts"),
      "@ramonda/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@ramonda/devtools": resolve(__dirname, "../../packages/devtools/src/index.ts"),
      "@ramonda/router": resolve(__dirname, "../../packages/router/src/index.ts"),
      "@ramonda/query": resolve(__dirname, "../../packages/query/src/index.ts"),
      "@ramonda/form": resolve(__dirname, "../../packages/form/src/index.ts"),
    },
  },
});
