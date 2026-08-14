import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

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
     * Shared with every other package now — this is where the number was first got wrong.
     *
     * It was 20 s, chosen against a then-worst case of 894 ms and called "deliberately far more than
     * the contention seen". It failed anyway, at 25.7 s, because the repository grew from 25
     * concurrent tasks to 45 and the contention grew with it. A multiple of today's worst case
     * expires; the reasoning and the measurements are in `vitest.timeout.mjs`.
     */
    testTimeout,
    hookTimeout,
  },
});
