import { defineConfig } from "vite";
import { coverage } from "../../vitest.coverage.mjs";
import { configDefaults } from "vitest/config";
import { resolve } from "node:path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
      compilerOptions: {
        stripInternal: true,
      },
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "RamondaCore",
      fileName: "index",
      formats: ["es"],
    },
    rollupOptions: {
      // Eksternalizuj samo ono što stvarno nije deo core-a
      external: [/^@ramonda\//],
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    target: "es2022",
  },
  // Core cannot resolve its own published name, so point it at the source.
  resolve: {
    alias: {
      "@ramonda/core/jsx-dev-runtime": resolve(__dirname, "src/jsx-dev-runtime.ts"),
      "@ramonda/core/jsx-runtime": resolve(__dirname, "src/jsx-runtime.ts"),
    },
  },
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: 'process.env.NODE_ENV === "test"',
  },
  // Vitest ostaje isti
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // `*.prod.test.*` cover production-only safety code (the update/mount loop
    // stops) and assume `__DEV__` is false. They only make sense under
    // NODE_ENV=production, so the default (dev) run skips them and `test:prod`
    // runs them alone via vitest.prod.config.ts.
    exclude: [...configDefaults.exclude, "**/*.prod.test.*"],
  },
});
