import { defineConfig } from "tsup";

/**
 * Two builds, dev and prod, for the same reason core, lens and query are built twice: this
 * package has a `__DEV__`-only diagnostic of its own (the `onSubmit` failure report) and it
 * must not ship.
 *
 * Core stays external — one copy of the framework, or the hook a component uses is not the
 * hook the app rendered.
 *
 * No JSX factory is injected. Nothing here renders: a form is a hook, which is what lets it
 * sit inside a `<fieldset>` or a `<tr>` where an extra element would be illegal.
 */
export default defineConfig([
  {
    // `bguard.ts` is a SEPARATE entry, not part of the main graph: it is the only file that imports
    // bguard, and a form over zod must not pull a validator it does not use into the bundle.
    entry: ["src/index.ts", "src/bguard.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "es2022",
    external: ["@ramonda/core", "bguard"],
    define: { __DEV__: "true", __TEST__: "false" },
    outDir: "dist",
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "es2022",
    minify: true,
    external: ["@ramonda/core", "bguard"],
    define: { __DEV__: "false", __TEST__: "false" },
    outExtension() {
      return { js: ".prod.js" };
    },
    outDir: "dist",
  },
]);
