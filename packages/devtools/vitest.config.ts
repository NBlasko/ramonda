import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";

/**
 * The panel is a custom element, so jsdom is enough to test it — it renders into a shadow root
 * and reads a tree the app publishes on `window`.
 *
 * This package had no tests until the navigation work, and three regressions in a row argued for
 * them: the tab flickered while idle, an interpolated hash threw on every poll, and both Query
 * buttons were dead because an attribute was never escaped. Each one is a DOM fact a jsdom test
 * can hold on to.
 */
export default defineConfig({
  /**
   * `@ramonda/lens` pinned to its DEVELOPMENT build.
   *
   * The package publishes both under export conditions, and which one a bare specifier resolves to
   * depends on `NODE_ENV` — so `src/__tests__/reporters.test.ts` would silently get the production
   * bundle, where every diagnostic is compiled out, in any job that sets it. Six cases fail with
   * "expected 0 records", which reads as a broken bridge and is nothing of the kind.
   *
   * The specifier stays a package name in the test, so the workspace dependency is real and turbo
   * still builds lens first. What this removes is the ambient part of the answer.
   */
  resolve: {
    alias: { "@ramonda/lens": resolve(import.meta.dirname, "../lens/dist/index.js") },
  },
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
    /**
     * Headroom, because the default gates these on the machine's spare capacity.
     *
     * Nothing here asserts a duration — every case is a DOM fact — but a panel test mounts a custom
     * element, attaches a shadow root and lays out a tree, and jsdom charges for all of it. Measured:
     * the slowest case takes 894ms alone and this file takes 9 seconds, while the same file inside
     * `turbo run test` — 25 tasks at once, which is what CI runs — took 77 seconds, and one case
     * crossed the 5-second default and failed. Twice more, forced, it passed. That is a flake, and a
     * flake in a gate is worse than a slow gate: it teaches everyone to re-run it.
     *
     * Twenty seconds against a 894ms worst case is deliberately far more than the contention seen, so
     * that a slower CI runner has room too. It cannot hide a real regression: a test that starts
     * taking twenty seconds has stopped being one of these.
     */
    testTimeout: 20_000,
  },
});
