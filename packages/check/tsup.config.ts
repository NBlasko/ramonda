import { defineConfig } from "tsup";

// A Node tool, not a runtime: one plain build, no dev/prod split, and `typescript` stays
// external — the analyzer uses the app's own compiler so it reads the app's own syntax.
//
// ## The warning this build prints on every run, and why it is right
//
//     ▲ [WARNING] Ignoring this import because "../css/dist/chunk-…js" was marked as having
//       no side effects [ignored-bare-import]
//
// `@ramonda/css` is bundled in here — it is a devDependency, and only `mayHoldABlock` and
// `virtualFile` survive the shake, measured on the output: the CSS rule engine is not in `dist`.
// Its build splits chunks, and one of them arrives as a bare `import "…chunk-…js"` with no
// bindings. That chunk is `src/conditions.ts`, which declares functions and does nothing at module
// scope, so dropping the import changes nothing — and `sideEffects: false` is what tells esbuild it
// may.
//
// The claim behind it is not taken on trust: `scripts/check-side-effects.mjs` bundles a bare import
// of each published package through a real bundler and requires `pure` to come out as nothing. A
// package that gained an import-time effect fails there, and this warning would then be pointing at
// something real.

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "node",
  external: ["typescript"],
});
