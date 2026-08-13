import { defineConfig } from "tsup";

/**
 * One build, not the dev/prod pair the runtime packages ship: nothing here runs in a browser and
 * nothing here reads `__DEV__`. It is build-time configuration, and there is only one of it.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts", "src/esbuild.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  outDir: "dist",
});
