import { defineConfig } from "vitest/config";
import { withFloor } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

export default defineConfig({
  test: {
    // 100% today, and a floor a point under it so ordinary work does not fight it.
    coverage: withFloor(99),
    testTimeout,
    hookTimeout,
    globals: true,
    // Nothing here touches a DOM: the runtime half builds a plain object and the compiler half is
    // text. A jsdom environment would only hide an accidental reach for `document`.
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
