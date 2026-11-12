import { defineConfig } from "tsup";
import { dts } from "../../tsup.dts";

// A Node tool, like `@ramonda/check`: one plain build, and its dependencies stay dependencies —
// `typescript` is the app's own, and `@ramonda/check` is the checker the app's build runs.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: { ...dts, entry: ["src/index.ts"] },
  clean: true,
  target: "es2022",
  platform: "node",
  external: ["typescript", "@ramonda/check", "@modelcontextprotocol/server", "zod"],
});
