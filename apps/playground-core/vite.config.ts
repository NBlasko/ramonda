import { defineConfig } from "vite";
import { resolve } from "node:path";
import { ramonda } from "@ramonda/build/vite";
import { ramondaCss } from "@ramonda/css/vite";

export default defineConfig({
  // The same plugin a scaffolded app gets, which is the point of using it here: it carries the three
  // transform settings, one of which decides whether the decorators survive into the output.
  // `ramondaCss` first: it must run before esbuild, which refuses the syntax at the parse step.
  plugins: [ramondaCss(), ramonda()],
  server: {
    port: 3000,
  },
  // The framework guards dev-only code with `if (__DEV__)`. Define it so the
  // playground runs (and so the devtools + dev logs are active).
  define: {
    __DEV__: JSON.stringify(true),
  },
  resolve: {
    alias: {
      // First: a string alias also matches `<key>/…`, so `@ramonda/core` would otherwise capture
      // these and rewrite them to `…/index.ts/jsx-runtime`.
      "@ramonda/core/jsx-dev-runtime": resolve(__dirname, "../../packages/core/src/jsx-dev-runtime.ts"),
      "@ramonda/core/jsx-runtime": resolve(__dirname, "../../packages/core/src/jsx-runtime.ts"),
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
