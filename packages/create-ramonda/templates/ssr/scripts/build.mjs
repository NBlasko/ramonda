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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { ramondaOptions, ramondaDefine } from "@ramonda/build/esbuild";

const shared = {
  ...ramondaOptions,
  bundle: true,
  format: "esm",
  // The production condition picks `@ramonda/core`'s optimized build, and `__DEV__` compiles the
  // development-only branches out of your own code.
  conditions: ["production"],
  // Through `ramondaDefine` because writing `define` plainly would drop the entries that make
  // `import.meta.env.RAMONDA_PUBLIC_*` readable — see its own note.
  define: ramondaDefine({ __DEV__: "false" }),
  // Where a bundler plugin goes, in both builds at once — `@ramonda/css`'s, for instance.
  plugins: [],
};

const client = await build({
  ...shared,
  entryPoints: ["src/entry-client.tsx"],
  outfile: "dist/client/assets/client.js",
  // So the build says which stylesheet it wrote, rather than this script guessing a file name.
  metafile: true,
});

await build({
  ...shared,
  entryPoints: ["src/entry-server.tsx"],
  platform: "node",
  outfile: "dist/server/entry-server.js",
});

/**
 * The page shell production serves, written ONCE here, where the build knows what it emitted —
 * `server.mjs` and `scripts/prerender.mjs` both read this file and change nothing in it.
 *
 * `index.html` points at `/src/entry-client.tsx`, which exists only under the dev server. Here it
 * points at the bundle instead, and at the stylesheet esbuild wrote beside it, if it wrote one: any
 * CSS the client imports — a style block's, a plain `.css` file's — lands in that one file, and
 * nothing loads it unless the page links it. Under the dev server Vite injects it from the module
 * itself, which is why `index.html` has no link to write.
 */
const SOURCE_ENTRY = "/src/entry-client.tsx";
const shell = readFileSync("index.html", "utf8");
// A rewrite that matched nothing would ship pages that never hydrate, and exit 0.
if (!shell.includes(SOURCE_ENTRY)) throw new Error(`index.html no longer loads ${SOURCE_ENTRY}`);
const css = client.metafile.outputs["dist/client/assets/client.js"]?.cssBundle;
const link = css === undefined ? "" : `<link rel="stylesheet" href="${css.slice("dist/client".length)}" />\n  `;
mkdirSync("dist/client", { recursive: true });
writeFileSync(
  "dist/client/index.html",
  shell.replace(SOURCE_ENTRY, "/assets/client.js").replace("</head>", `${link}</head>`),
);
