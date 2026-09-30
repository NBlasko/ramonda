/**
 * Import a TypeScript module of a package from a build script.
 *
 * Node can run a single `.ts` file, but not one that imports a sibling without an extension — which
 * is how every module in `packages/css/src` is written, because the bundler resolves them. So the
 * entry is bundled in memory with esbuild, which the package already depends on, and imported as a
 * data URL. Nothing is written to disk and no build step has to run first.
 */
import { createRequire } from "node:module";

const esbuild = createRequire(new URL("../packages/css/package.json", import.meta.url).pathname)("esbuild");

export async function loadTs(entry) {
  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const source = built.outputFiles[0]?.text ?? "";
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}
