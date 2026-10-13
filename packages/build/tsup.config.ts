import { defineConfig } from "tsup";
import { dts } from "../../tsup.dts";

/**
 * One build, not the dev/prod pair the runtime packages ship: nothing here runs in a browser and
 * nothing here reads `__DEV__`. It is build-time configuration, and there is only one of it.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts", "src/esbuild.ts"],
  format: ["esm"],
  dts,
  clean: true,
  target: "es2022",
  outDir: "dist",
});
