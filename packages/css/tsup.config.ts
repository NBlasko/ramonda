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
    /**
     * The clean lives HERE, on the first block, and that is not tidying.
     *
     * It was on the ESM block, which is not the first — and tsup runs the blocks concurrently, so
     * the clean landed after another block had already written its declarations. Measured: tsup
     * reported `DTS dist/config.d.ts 17.56 KB` and the file was not there afterwards, which is the
     * worst shape of failure — a build that says it wrote something it did not.
     */
    clean: true,
    outDir: "dist",
  },
  {
    entry: [
      "src/index.ts",
      "src/compiler/index.ts",
      "src/properties.ts",
      "src/cli.ts",
      "src/vite.ts",
      "src/esbuild.ts",
      "src/plugin.ts",
      "src/prettier.ts",
    ],
    format: ["esm"],
    dts: true,
    target: "es2022",
    outDir: "dist",
  },
  /**
   * The config's own entry, in BOTH formats, and the second one is the point.
   *
   * A `ramonda.css.ts` is transpiled to CommonJS and `require`d — that is what makes it loadable in
   * an editor — so anything it imports must be requirable. Measured before this existed: a config
   * doing `import { kind } from "@ramonda/css"` died with `No "exports" main defined`, in every
   * project rather than only in a test. The main entry stays ESM-only, because it is what a page
   * loads and it imports nothing.
   */
  {
    entry: { config: "src/configEntry.ts" },
    format: ["esm", "cjs"],
    dts: true,
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
