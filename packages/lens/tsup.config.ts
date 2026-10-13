import { defineConfig } from "tsup";
import { dts } from "../../tsup.dts";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts,
    clean: true,
    target: "es2022",
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
