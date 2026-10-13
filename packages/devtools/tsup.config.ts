import { defineConfig } from "tsup";
import { dts } from "../../tsup.dts";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts,
  clean: true,
});
