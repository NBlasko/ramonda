import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/compiler/index.ts", "src/properties.ts", "src/cli.ts"],
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
