import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

/**
 * The `@ramonda/*` range the scaffolder writes is taken from the workspace at BUILD time,
 * not hand-maintained in the source.
 *
 * It was a constant, and it went stale: the scaffolder shipped pinning `~0.0.1` while core
 * and query were published at 0.1.0, so a fresh project's very first install failed with
 * `No matching version found for @ramonda/query@~0.0.1`. Nothing could have caught it — the
 * pre-publish gate skips first-party packages on purpose, to avoid racing their own publish.
 *
 * Reading them here is exact for the release flow: `pnpm release` runs
 * `changeset version` first, so by the time this builds, the version on disk is the one being
 * published.
 */
const ranges: Record<string, string> = {};
for (const folder of ["core", "router", "query", "lens", "devtools", "testing-library"]) {
  const pkg = JSON.parse(readFileSync(new URL(`../${folder}/package.json`, import.meta.url), "utf8")) as {
    name: string;
    version: string;
  };
  // A tilde, not a caret: on a `0.0.z` version a caret pins that exact patch, so a scaffold
  // would never pick up the next one. `~0.0.4` is `>=0.0.4 <0.1.0`, and for `0.1.0` the two
  // are the same.
  ranges[pkg.name] = `~${pkg.version}`;
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  // One range per package, because they do NOT share a version: core and query are at
  // 0.1.0 while router, lens and testing-library are on their own 0.0.x lines. A single
  // derived range was the first attempt, and the release gate caught it immediately.
  define: { __RAMONDA_RANGES__: JSON.stringify(ranges) },
  // The published bin must be directly executable.
  banner: { js: "#!/usr/bin/env node" },
});
