import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/testing.ts", "src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    format: ["esm"], // SAMO ESM
    dts: true,
    clean: true,
    target: "es2022",
    define: {
      __DEV__: "true",
      __TEST__: "false",
    },
    outDir: "dist",
  },
  {
    entry: ["src/index.ts", "src/testing.ts", "src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    format: ["esm"], // SAMO ESM
    target: "es2022",
    minify: true,
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
