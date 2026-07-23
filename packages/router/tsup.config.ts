import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";

// Router imports `h` implicitly through JSX, so the factory is injected here the
// same way the app builds do. Core stays external: the router and the app must
// share ONE copy of the framework (it holds module-level state — the update
// queue, the reactive context), and bundling a second would break that.
//
// Single build, no dev/prod split: router's own source uses no `__DEV__`, so
// there is nothing to strip. Any dev-only behavior lives in core, which the
// output imports and which ships its own dev and prod entries.
const jsxShim = fileURLToPath(new URL("./jsx-shim.ts", import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["@ramonda/core", "@ramonda/core/testing"],
  esbuildOptions(options) {
    options.jsx = "transform";
    options.jsxFactory = "h";
    options.jsxFragment = "Fragment";
    options.inject = [jsxShim];
  },
});
