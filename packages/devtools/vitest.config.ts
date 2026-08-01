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
  test: {
    coverage,
    globals: true,
    environment: "jsdom",
  },
});
