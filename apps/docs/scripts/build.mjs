#!/usr/bin/env node
/**
 * The site's two bundles: the client that hydrates, and the server the prerender loads.
 *
 * A script rather than two `esbuild` command lines, because of `ramondaOptions`. It carries the
 * settings Ramonda needs from the transform — `jsx`, `jsxImportSource` and `target` — and spreading
 * it is one thing to get right instead of three, in each of two places, kept in step by hand.
 *
 * `target` is the one that bites: Ramonda's decorators are TC39 stage-3 and no engine parses them,
 * so a build that does not lower them emits a file that dies with `SyntaxError: Invalid or
 * unexpected token` on the first page load. That reached a browser once, from this very site.
 * `esnext` — also esbuild's DEFAULT — is the broken value, so a command line that merely drops the
 * flag has already chosen it. `ramonda-check-bundle` later in `build` is the second line of
 * defence; this is the first.
 *
 * Usage: node scripts/build.mjs [client|server]   (both when given nothing)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ramonda, ramondaOptions } from "@ramonda/build/esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every `@ramonda/*` import resolved to this workspace's SOURCE, so the site is always built
 * against the tree being edited. This app's own business, not a Ramonda setting — which is why it
 * sits beside the spread rather than inside it.
 */
const packages = "../../packages";
const alias = {
  "@ramonda/theme": `${packages}/theme/src/index.ts`,
  "@ramonda/core/jsx-dev-runtime": `${packages}/core/src/jsx-dev-runtime.ts`,
  "@ramonda/core/jsx-runtime": `${packages}/core/src/jsx-runtime.ts`,
  "@ramonda/core": `${packages}/core/src/index.ts`,
  "@ramonda/form": `${packages}/form/src/index.ts`,
  "@ramonda/router": `${packages}/router/src/index.ts`,
  "@ramonda/lens": `${packages}/lens/src/index.ts`,
  "@ramonda/query": `${packages}/query/src/index.ts`,
  // The panel is a browser thing and this site does not ship it; the stub keeps the import from
  // dragging it — and the DOM — into either bundle.
  "@ramonda/devtools": "./devtools-stub.ts",
};

const shared = {
  // Both halves on purpose. The spread STATES the settings, where a reader can see them; the
  // plugin REFUSES a target that would leave the decorators in — including one written below this
  // spread, which silently wins otherwise. Measured: `target: "esnext"` under the spread alone
  // builds happily and exits 0, and the failure surfaces later as a bundle that does not parse.
  plugins: [ramonda()],
  ...ramondaOptions,
  bundle: true,
  format: "esm",
  alias,
  splitting: true,
  define: { __DEV__: "false" },
  chunkNames: "chunk-[hash]",
};

const targets = {
  client: {
    ...shared,
    entryPoints: ["src/entry-client.tsx"],
    minify: true,
    outdir: "dist/assets",
    entryNames: "client",
    // Read by `build-manifest.mjs`, which turns it into the per-page preload list.
    metafile: true,
  },
  server: {
    ...shared,
    entryPoints: ["src/entry-server.tsx"],
    platform: "node",
    outdir: ".build",
    entryNames: "entry-server",
  },
};

const asked = process.argv[2];
if (asked !== undefined && targets[asked] === undefined) {
  console.error(`[build] no such target: ${asked} — one of ${Object.keys(targets).join(", ")}`);
  process.exit(2);
}

for (const [name, options] of Object.entries(targets)) {
  if (asked !== undefined && asked !== name) continue;
  const result = await build(options);
  if (options.metafile) {
    // The CLI wrote this with `--metafile=`; through the API it comes back on the result and the
    // caller writes it. Same file, same reader.
    mkdirSync(join(root, ".build"), { recursive: true });
    writeFileSync(join(root, ".build", "meta.json"), JSON.stringify(result.metafile));
  }
  console.log(`[build] ${name} → ${options.outdir}`);
}
