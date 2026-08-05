import { defineConfig } from "tsup";

// The router's own JSX compiles through the automatic runtime, so nothing is injected and no
// factory is named: the compiler emits an import from `@ramonda/core/jsx-runtime` per file.
//
// Core stays external, and that is the important part: the router and the app must share ONE copy
// of the framework — it holds module-level state, the update queue and the reactive context — and
// bundling a second would break that. The runtime subpath is external for the same reason.
//
// Single build, no dev/prod split: router's own source uses no `__DEV__`, so there is nothing to
// strip. Any dev-only behavior lives in core, which the output imports and which ships its own
// dev and prod entries.
export default defineConfig({
  entry: ["src/index.ts", "src/server.ts", "src/server.browser.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["@ramonda/core", "@ramonda/core/testing", "@ramonda/core/jsx-runtime", "@ramonda/core/jsx-dev-runtime"],
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "@ramonda/core";
  },
});
