import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

/**
 * No `define` block: this module has no `__DEV__` in it and no production half, so there is one
 * behaviour to test and one run to test it in.
 *
 * `node`, and the irony is worth naming — a package of DOM facts needs no DOM to test. It holds
 * two tables and two lookups; the consumers that act on the answers are `@ramonda/core`, which
 * builds the element, and `@ramonda/check`, which reads the source.
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
