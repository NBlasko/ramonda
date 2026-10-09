import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

// Used by the DEV server only (server.mjs in middleware mode). The production build is esbuild —
// see scripts/build.mjs, which takes the same settings from the same package.
//
// `ramonda()` is the whole transform configuration. It sets the JSX runtime, which has to agree with
// your tsconfig, and it compiles away `@state`, `@compute` and the rest: they are TC39 decorators,
// which no engine can parse, and Vite's own transform leaves them in. Without the plugin the dev
// server still starts, warns about nothing, and hands the browser a module that dies with
// `SyntaxError: Invalid or unexpected token`.
export default defineConfig({
  define: { __DEV__: "true" },
  plugins: [ramonda()],
});
