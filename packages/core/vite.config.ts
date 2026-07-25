import { defineConfig } from "vite";
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
    jsxFactory: "h",
    jsxFragment: "Fragment",
    target: "es2022",
  },
  define: {
    __DEV__: 'process.env.NODE_ENV !== "production"',
    __TEST__: 'process.env.NODE_ENV === "test"',
  },
  // Vitest ostaje isti
  test: {
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
