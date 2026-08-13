#!/usr/bin/env node
/**
 * The production build: two bundles, client and server.
 *
 * This is a script rather than two `esbuild` command lines because of `ramondaOptions`. It carries
 * the three settings Ramonda needs from the transform — `jsx`, `jsxImportSource` and `target` — and
 * spreading it is one thing to get right instead of three, in each of two places, kept in step by
 * hand forever. `target` in particular decides whether the decorators survive into the output; see
 * the note in vite.config.ts, which is the same settings for the dev server.
 *
 * Everything below the spread is this project's own business: what to build, for which platform, and
 * where to put it.
 */
import { build } from "esbuild";
import { ramondaOptions } from "@ramonda/build/esbuild";

const shared = {
  ...ramondaOptions,
  bundle: true,
  format: "esm",
  // The production condition picks `@ramonda/core`'s optimized build, and `__DEV__` compiles the
  // development-only branches out of your own code.
  conditions: ["production"],
  define: { __DEV__: "false" },
};

await build({
  ...shared,
  entryPoints: ["src/entry-client.tsx"],
  outfile: "dist/client/assets/client.js",
});

await build({
  ...shared,
  entryPoints: ["src/entry-server.tsx"],
  platform: "node",
  outfile: "dist/server/entry-server.js",
});
