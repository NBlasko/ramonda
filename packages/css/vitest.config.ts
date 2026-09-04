import { defineConfig } from "vitest/config";
import { withFloor } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

export default defineConfig({
  test: {
    coverage: {
      ...withFloor(99),
      exclude: [
        ...withFloor(99).exclude,
        /**
         * The command's shell: argument parsing, printing and `process.exit`. Every decision it makes
         * is in `check.ts` and is tested there, and what is left cannot be reached in-process at all.
         *
         * Not left uncovered instead: `__tests__/cli.test.ts` runs the real bin as a subprocess and
         * asserts what a build actually depends on — the exit code and what comes out.
         */
        "src/cli.ts",
      ],
    },
    testTimeout,
    hookTimeout,
    globals: true,
    // Nothing here touches a DOM: the runtime half builds a plain object and the compiler half is
    // text. A jsdom environment would only hide an accidental reach for `document`.
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
