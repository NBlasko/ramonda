import { defineConfig } from "tsup";

// A Node tool, not a runtime: one plain build, no dev/prod split, and `typescript` stays
// external — the analyzer uses the app's own compiler so it reads the app's own syntax.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "node",
  external: ["typescript"],
});
