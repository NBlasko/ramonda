import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

// `ramonda()` is the whole transform configuration. It sets `jsx`, `jsxImportSource` and `target`,
// which have to agree with each other and with your tsconfig, and one of which is load-bearing in a
// way nothing would tell you about: `@state`, `@compute` and the rest are TC39 decorators, which no
// engine can parse, and esbuild only compiles them away below `esnext`. Set that one wrong and the
// build succeeds, warns about nothing, and hands the browser a file that dies with
// `SyntaxError: Invalid or unexpected token`.
//
// So the framework owns those three, you own the rest, and `ramonda-check-bundle` at the end of
// `npm run build` parses what came out — because a setting that decides whether your app runs
// deserves more than a comment.
//
// `@ramonda/core` ships separate dev/prod builds, so Vite already gives you development output on
// `vite dev` and optimized output on `vite build`.
export default defineConfig({
  plugins: [ramonda()],
  server: {
    port: 3000,
  },
});
