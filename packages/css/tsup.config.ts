import { defineConfig } from "tsup";

export default defineConfig([
  /**
   * The language service plugin, and it is the only CommonJS thing here.
   *
   * Measured: `tsserver` loads a plugin with a synchronous `require` and then checks
   * `typeof factory === "function"`. On Node 24 `require()` of an ESM module works, but it returns
   * the module NAMESPACE — an object — so an ESM plugin is silently skipped with an info-level log
   * nobody reads. `module.exports = factory` is what it has to be.
   *
   * Bundled rather than importing the ESM build, so there is no cross-format require at runtime at
   * all. It needs no `magic-string`: the plugin reads the virtual file and never emits.
   */
  {
    entry: { plugin: "src/plugin.cjs.ts" },
    format: ["cjs"],
    target: "es2022",
    outExtension() {
      return { js: ".cjs" };
    },
    /**
     * The last line, and it is what makes the file loadable at all.
     *
     * A default export compiles to `module.exports = { __esModule: true, default: init }`, and
     * `tsserver` checks `typeof factory === "function"` — measured, an object is skipped. So the
     * default is hoisted to be the export itself.
     */
    footer: { js: "module.exports = module.exports.default;" },
    outDir: "dist",
  },
  {
    entry: ["src/index.ts", "src/compiler/index.ts", "src/properties.ts", "src/cli.ts", "src/vite.ts", "src/plugin.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "es2022",
    outDir: "dist",
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "es2022",
    minify: true,
    outExtension() {
      return { js: ".prod.js" };
    },
    outDir: "dist",
  },
]);
