import { defineConfig } from "tsup";

/**
 * One build, like `@ramonda/build`: nothing here runs in a browser and nothing reads `__DEV__`.
 * `linkedom` stays external — it is a peer, so the app resolves the copy it installed.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  outDir: "dist",
  external: ["linkedom"],
});
