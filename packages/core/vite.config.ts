import { defineConfig } from "vite";
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
  },
});
