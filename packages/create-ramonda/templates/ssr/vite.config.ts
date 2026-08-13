import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

// Used by the DEV server only (server.mjs in middleware mode). The production build is esbuild —
// see scripts/build.mjs, which takes the same settings from the same package.
//
// `ramonda()` is the whole transform configuration. It sets `jsx`, `jsxImportSource` and `target`,
// which have to agree with each other and with your tsconfig, and one of which is load-bearing in a
// way nothing would tell you about: `@state`, `@compute` and the rest are TC39 decorators, which no
// engine can parse, and esbuild only compiles them away below `esnext`. Set that one wrong and the
// dev server still starts, warns about nothing, and hands the browser a module that dies with
// `SyntaxError: Invalid or unexpected token`.
export default defineConfig({
  define: { __DEV__: "true" },
  plugins: [ramonda()],
});
