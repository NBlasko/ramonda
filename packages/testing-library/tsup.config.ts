import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/dont-cleanup-after-each.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  // Kept external: the framework and the query library are the consumer's, and
  // bundling either would give a project two copies of a module that keeps
  // module-level state (the update queue, the DOM library's config).
  external: ["@ramonda/core", "@ramonda/core/testing", "@testing-library/dom"],
  define: {
    __DEV__: "true",
    __TEST__: "false",
  },
  outDir: "dist",
});
