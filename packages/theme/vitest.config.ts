import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

/**
 * No `define` block, unlike every other package's: this module has no `__DEV__` in it and no
 * production half, so there is one behaviour to test and one run to test it in.
 *
 * `node`, because nothing here touches a DOM. It builds STRINGS — CSS declarations, inline SVG, a
 * `url()` for a mask — and the consumer that puts them in a document is `@ramonda/devtools`.
 */
export default defineConfig({
  test: {
    coverage,
    testTimeout,
    hookTimeout,
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
