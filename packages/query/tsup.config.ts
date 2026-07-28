import { defineConfig } from "tsup";

/**
 * Two builds, dev and prod, because this package has DEV-only diagnostics of its
 * own and they must not ship. That is the same reason core and lens are built
 * twice; the router is not, because its source contains no `__DEV__`.
 *
 * Core stays external: the query cache lives on the tree, and the tree is core's
 * — one copy of the framework, or the hook a component uses is not the hook the
 * app rendered. (Core also holds module-level state: the update queue, the
 * reactive context.)
 *
 * No JSX factory is injected. Nothing here renders — a provider, an observer and
 * a mutation are all hooks, which is what lets them sit inside a `<tr>` or a
 * `<select>` where an extra element would be illegal. Tests do use JSX, and get
 * `h` from the vitest setup file instead.
 */
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "es2022",
    external: ["@ramonda/core"],
    define: {
      __DEV__: "true",
      __TEST__: "false",
    },
    outDir: "dist",
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "es2022",
    minify: true,
    external: ["@ramonda/core"],
    define: {
      __DEV__: "false",
      __TEST__: "false",
    },
    outExtension() {
      return { js: ".prod.js" };
    },
    outDir: "dist",
  },
]);
