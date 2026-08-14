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
 * Reading them here is exact for the release flow. `changeset version` runs in its own step and
 * opens the "Version Packages" PR; merging that PR is what runs `pnpm release`, which builds and
 * then publishes. So by the time this file is evaluated the bump is already committed, and the
 * version on disk is the one about to go to npm.
 */
const ranges: Record<string, string> = {};
for (const folder of [
  "core",
  "router",
  "query",
  "form",
  "lens",
  "devtools",
  "testing-library",
  "check",
  "build",
  "server",
]) {
  const pkg = JSON.parse(readFileSync(new URL(`../${folder}/package.json`, import.meta.url), "utf8")) as {
    name: string;
    version: string;
  };
  // A tilde, not a caret: on a `0.0.z` version a caret pins that exact patch, so a scaffold
  // would never pick up the next one. `~0.0.4` is `>=0.0.4 <0.1.0`, and for `0.1.0` the two
  // are the same.
  ranges[pkg.name] = `~${pkg.version}`;
}

/**
 * The third-party ranges come from the workspace too, from whichever package actually uses
 * the tool — so a generated project gets the combination the framework is tested against.
 *
 * They were hand-written constants, and one had already drifted: the template pinned
 * `vitest@^3.2.4` while core, testing-library and the docs app were all on `^4.1.10`. A
 * scaffolded project therefore ran its tests on a major the framework does not use.
 *
 * Exact pins are widened to a caret: this repo pins some tools exactly on purpose (a
 * reproducible lockfile), which is not what a generated project wants.
 */
function toolRanges(): Record<string, string> {
  const sources: Record<string, string> = {
    vitest: "../core",
    vite: "../core",
    jsdom: "../core",
    "@types/node": "../core",
    typescript: "../../package.json",
    "@biomejs/biome": "../../package.json",
    esbuild: "../../apps/docs",
  };

  const out: Record<string, string> = {};
  for (const [tool, source] of Object.entries(sources)) {
    const url = new URL(source.endsWith("package.json") ? source : `${source}/package.json`, import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const found = { ...pkg.dependencies, ...pkg.devDependencies }[tool];
    if (!found) throw new Error(`[create-ramonda] ${tool} is not declared in ${source}`);
    out[tool] = /^[\d]/.test(found) ? `^${found}` : found;
  }
  return out;
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  // One range per package, because they do NOT share a version: core and query are at
  // 0.1.0 while router, lens and testing-library are on their own 0.0.x lines. A single
  // derived range was the first attempt, and the release gate caught it immediately.
  define: {
    __RAMONDA_RANGES__: JSON.stringify(ranges),
    __TOOL_RANGES__: JSON.stringify(toolRanges()),
  },
  // The published bin must be directly executable.
  banner: { js: "#!/usr/bin/env node" },
});
